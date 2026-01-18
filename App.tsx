
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { TranscriptionEntry, ConnectionStatus } from './types';
import { decode, decodeAudioData, createPcmBlob } from './utils/audioUtils';
import VoiceVisualizer from './components/VoiceVisualizer';
import DentalServices from './components/DentalServices';

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [transcriptions, setTranscriptions] = useState<TranscriptionEntry[]>([]);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isProcessingTool, setIsProcessingTool] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastBooking, setLastBooking] = useState<{name: string, date: string, time: string} | null>(null);
  const [textInput, setTextInput] = useState('');

  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const activeAudioCountRef = useRef<number>(0);
  
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');

  // API_KEY must come from the environment (injected via Vite define)
  const API_KEY = process.env.API_KEY;

  const quickPrompts = [
    { label: "Book Appointment", text: "I'd like to book a dental appointment, please." },
    { label: "Price Check", text: "How much is a tooth cleaning or filling?" },
    { label: "Clinic Hours", text: "What are your opening hours in Antipolo?" },
    { label: "About Dr. Mia", text: "Tell me about Dr. Gloryner Mia's expertise." }
  ];

  const stopSession = useCallback(() => {
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then((session: any) => session.close());
      sessionPromiseRef.current = null;
    }
    
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    activeSourcesRef.current.clear();
    activeAudioCountRef.current = 0;
    
    if (inputAudioContextRef.current) inputAudioContextRef.current.close();
    if (outputAudioContextRef.current) outputAudioContextRef.current.close();
    
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    
    setStatus(ConnectionStatus.DISCONNECTED);
    setIsUserSpeaking(false);
    setIsAiSpeaking(false);
    setIsProcessingTool(false);
  }, []);

  const bookAppointmentTool: FunctionDeclaration = {
    name: 'bookAppointment',
    parameters: {
      type: Type.OBJECT,
      description: 'Notify the dental coordinators to finalize a patient appointment.',
      properties: {
        clientName: { type: Type.STRING, description: 'Full name of the patient.' },
        appointmentDate: { type: Type.STRING, description: 'Requested date (YYYY-MM-DD).' },
        appointmentTime: { type: Type.STRING, description: 'Requested time (e.g., 5:00 PM).' },
        purpose: { type: Type.STRING, description: 'Service needed (e.g., cleaning, extraction).' },
      },
      required: ['clientName', 'appointmentDate', 'appointmentTime', 'purpose'],
    },
  };

  const handleSendText = (customText?: string) => {
    const message = customText || textInput.trim();
    if (!message || !sessionPromiseRef.current) return;
    
    setTranscriptions(prev => [...prev, { role: 'user', text: message, timestamp: Date.now() }]);
    sessionPromiseRef.current.then((session) => {
      session.sendRealtimeInput({ text: message });
    });
    if (!customText) setTextInput('');
  };

  const startSession = async () => {
    // Robust key check for production deployments
    if (!API_KEY || API_KEY === "" || API_KEY === "undefined") {
      setErrorMsg("API Key Missing: Go to Vercel Settings > Env Variables, add 'API_KEY', and Redeploy.");
      setStatus(ConnectionStatus.ERROR);
      return;
    }

    try {
      setStatus(ConnectionStatus.CONNECTING);
      setErrorMsg(null);

      const ai = new GoogleGenAI({ apiKey: API_KEY });
      const inCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      inputAudioContextRef.current = inCtx;
      outputAudioContextRef.current = outCtx;

      await inCtx.resume();
      await outCtx.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setStatus(ConnectionStatus.CONNECTED);
            
            const source = inCtx.createMediaStreamSource(stream);
            const scriptProcessor = inCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              let max = 0;
              for(let i=0; i<inputData.length; i++) { if(Math.abs(inputData[i]) > max) max = Math.abs(inputData[i]); }
              setIsUserSpeaking(max > 0.05);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then((session) => { session.sendRealtimeInput({ media: pcmBlob }); });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inCtx.destination);

            sessionPromise.then((session) => {
              session.sendRealtimeInput({ 
                text: "Greet the patient warmly in Taglish. 'Kumusta! Ako si Mia, ang iyong digital assistant dito sa G.C Mia Dental Clinic. Paano kita matutulungan ngayon?' Be proactive: if they want an appointment, ask for their name and preferred schedule immediately." 
              });
            });
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) {
              setIsProcessingTool(true);
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'bookAppointment') {
                  const args = fc.args as any;
                  try {
                    await new Promise(r => setTimeout(r, 1500));
                    setLastBooking({ name: args.clientName, date: args.appointmentDate, time: args.appointmentTime });
                    sessionPromise.then((session) => {
                      session.sendToolResponse({
                        functionResponses: [{ id: fc.id, name: fc.name, response: { status: "success", confirmation: "Booking request received." } }]
                      });
                    });
                  } catch (err) {
                    sessionPromise.then((session) => {
                      session.sendToolResponse({
                        functionResponses: [{ id: fc.id, name: fc.name, response: { status: "error" } }]
                      });
                    });
                  }
                }
              }
              setTimeout(() => setIsProcessingTool(false), 500);
            }

            const modelTurn = message.serverContent?.modelTurn;
            if (modelTurn) {
              for (const part of modelTurn.parts) {
                if (part.inlineData?.data) {
                  const base64Audio = part.inlineData.data;
                  if (outputAudioContextRef.current) {
                    const ctx = outputAudioContextRef.current;
                    setIsAiSpeaking(true);
                    activeAudioCountRef.current++;
                    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                    try {
                      const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
                      const source = ctx.createBufferSource();
                      source.buffer = audioBuffer;
                      source.connect(ctx.destination);
                      source.onended = () => {
                        activeSourcesRef.current.delete(source);
                        activeAudioCountRef.current--;
                        if (activeAudioCountRef.current <= 0) { setIsAiSpeaking(false); activeAudioCountRef.current = 0; }
                      };
                      source.start(nextStartTimeRef.current);
                      nextStartTimeRef.current += audioBuffer.duration;
                      activeSourcesRef.current.add(source);
                    } catch (err) { activeAudioCountRef.current--; }
                  }
                }
              }
            }

            if (message.serverContent?.inputTranscription) currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
            if (message.serverContent?.outputTranscription) currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;

            if (message.serverContent?.turnComplete) {
              const uText = currentInputTranscriptionRef.current.trim();
              const aText = currentOutputTranscriptionRef.current.trim();
              if (uText || aText) {
                setTranscriptions(prev => [
                  ...prev, 
                  ...(uText ? [{ role: 'user', text: uText, timestamp: Date.now() } as TranscriptionEntry] : []),
                  ...(aText ? [{ role: 'assistant', text: aText, timestamp: Date.now() } as TranscriptionEntry] : [])
                ]);
              }
              currentInputTranscriptionRef.current = '';
              currentOutputTranscriptionRef.current = '';
            }

            if (message.serverContent?.interrupted) {
              activeSourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
              activeSourcesRef.current.clear();
              activeAudioCountRef.current = 0;
              nextStartTimeRef.current = 0;
              setIsAiSpeaking(false);
            }
          },
          onerror: (e) => {
            console.error(e);
            setStatus(ConnectionStatus.ERROR);
            setErrorMsg("Mia encountered a connection issue. Please refresh or check your API key.");
          },
          onclose: () => setStatus(ConnectionStatus.DISCONNECTED)
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          tools: [{ functionDeclarations: [bookAppointmentTool] }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are Mia, the expert Voice AI Receptionist for G.C Mia Dental Clinic.
          CLINIC DETAILS: Antipolo City, Rizal. Led by Dr. Gloryner Mia-Dibaratun.
          OPERATING HOURS: Mon-Thu (4pm-7pm), Sat-Sun (12pm-7pm). CLOSED on Fridays.
          SERVICES: Cleaning (Oral Prophylaxis), Extraction, Braces, Whitening, Root Canal.
          AGENTIC RULES: 
          1. Be proactive. If a user asks for prices, offer to book them.
          2. Use Taglish (Filipino-English mix) to sound local and friendly.
          3. When booking, use 'bookAppointment' tool as soon as you have name, date, and time.
          4. If they are unsure about a service, explain it simply.`
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err: any) {
      setStatus(ConnectionStatus.ERROR);
      setErrorMsg(err.message || 'Connection failed');
    }
  };

  const handleToggleConnection = () => {
    if (status === ConnectionStatus.CONNECTED || status === ConnectionStatus.CONNECTING) stopSession();
    else startSession();
  };

  useEffect(() => { return () => stopSession(); }, [stopSession]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white/90 backdrop-blur-xl border-b border-slate-100 sticky top-0 z-20 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-200/50">
              <i className="fas fa-tooth text-2xl"></i>
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-xl tracking-tight">G.C MIA <span className="text-blue-600">DENTAL</span></h1>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-black">Agentic Voice AI</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10 flex flex-col lg:flex-row gap-10">
        <div className="flex-1 space-y-10">
          {errorMsg && (
            <div className="bg-rose-50 border border-rose-100 p-5 rounded-3xl text-rose-600 text-xs font-bold flex items-center gap-4 animate-in fade-in slide-in-from-top-4">
              <div className="w-10 h-10 bg-rose-100 rounded-full flex items-center justify-center shrink-0">
                <i className="fas fa-key text-lg"></i>
              </div>
              <p>{errorMsg}</p>
            </div>
          )}

          {lastBooking && (
            <div className="bg-emerald-50 border border-emerald-100 p-6 rounded-[2rem] flex items-center gap-5 shadow-sm text-emerald-900 animate-in zoom-in-95">
              <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-md shrink-0">
                <i className="fas fa-calendar-check text-xl"></i>
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-sm">Appointment Requested</h4>
                <p className="text-[11px] opacity-75">{lastBooking.name} • {lastBooking.date} at {lastBooking.time}</p>
              </div>
              <button onClick={() => setLastBooking(null)} className="p-2 hover:bg-emerald-100 rounded-full transition-colors"><i className="fas fa-times"></i></button>
            </div>
          )}

          <section className="glass-card rounded-[2.5rem] p-12 text-center relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-400/5 rounded-full blur-3xl -mr-32 -mt-32"></div>
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-400/5 rounded-full blur-3xl -ml-32 -mb-32"></div>
            
            <h2 className="text-4xl font-black text-slate-900 mb-2 tracking-tight">Talk to Mia</h2>
            <p className="text-slate-400 text-sm mb-12">Ask about services, prices, or book an appointment.</p>
            
            <div className="relative flex flex-col items-center justify-center my-10">
              <div className={`relative w-44 h-44 rounded-[3rem] flex flex-col items-center justify-center transition-all duration-500 ${
                status === ConnectionStatus.CONNECTED ? 'bg-white shadow-[0_20px_50px_rgba(8,112,184,0.12)] scale-110' : 'bg-slate-50 border-2 border-dashed border-slate-200'
              }`}>
                {status === ConnectionStatus.CONNECTED ? (
                  <div className="flex flex-col items-center gap-4">
                    <VoiceVisualizer isActive={isAiSpeaking} color="bg-blue-600" />
                    <div className="h-px w-8 bg-slate-100"></div>
                    <VoiceVisualizer isActive={isUserSpeaking} color="bg-emerald-500" />
                  </div>
                ) : (
                  <i className="fas fa-microphone-slash text-3xl text-slate-200"></i>
                )}
              </div>
              
              {isProcessingTool && (
                <div className="absolute -bottom-6 bg-white border border-slate-100 px-4 py-2 rounded-full shadow-lg text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                  <i className="fas fa-circle-notch fa-spin"></i>
                  Processing Booking...
                </div>
              )}
            </div>

            <button
              onClick={handleToggleConnection}
              disabled={status === ConnectionStatus.CONNECTING}
              className={`px-12 py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-2xl transition-all active:scale-95 ${
                status === ConnectionStatus.CONNECTED ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-rose-200' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200'
              } disabled:opacity-50`}
            >
              {status === ConnectionStatus.CONNECTED ? 'End Conversation' : 'Start Consultation'}
            </button>
          </section>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {quickPrompts.map((p, i) => (
              <button 
                key={i}
                disabled={status !== ConnectionStatus.CONNECTED}
                onClick={() => handleSendText(p.text)}
                className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest bg-white border border-slate-100 rounded-2xl hover:border-blue-400 hover:text-blue-600 hover:shadow-lg transition-all disabled:opacity-30 disabled:hover:shadow-none"
              >
                {p.label}
              </button>
            ))}
          </div>

          <DentalServices />
        </div>

        <aside className="lg:w-[400px]">
          <div className="glass-card rounded-[2.5rem] flex flex-col shadow-2xl border-white h-[650px] overflow-hidden sticky top-28">
            <div className="p-6 border-b border-slate-50 bg-white/40 flex items-center justify-between">
              <span className="font-black text-[10px] text-slate-400 uppercase tracking-widest">Live Transcript</span>
              <button onClick={() => setTranscriptions([])} className="text-[10px] font-bold text-slate-300 hover:text-rose-500 transition-colors uppercase">Clear</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/30">
              {transcriptions.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center px-6 opacity-20">
                  <i className="fas fa-comment-dots text-4xl mb-4"></i>
                  <p className="text-xs font-bold">Transcription will appear here during the call.</p>
                </div>
              )}
              {transcriptions.map((t, i) => (
                <div key={i} className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[90%] p-5 rounded-3xl text-[12px] leading-relaxed shadow-sm ${
                    t.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-slate-100 text-slate-600 rounded-tl-none'
                  }`}>
                    {t.text}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-6 bg-white border-t border-slate-50">
              <div className="relative">
                <input 
                  type="text" 
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendText()}
                  placeholder="Type a message..."
                  disabled={status !== ConnectionStatus.CONNECTED}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 text-xs focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all disabled:opacity-50"
                />
                <button 
                  onClick={() => handleSendText()}
                  disabled={status !== ConnectionStatus.CONNECTED || !textInput.trim()}
                  className="absolute right-2 top-2 w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center hover:bg-blue-700 disabled:bg-slate-200 transition-all shadow-lg shadow-blue-200"
                >
                  <i className="fas fa-arrow-up text-sm"></i>
                </button>
              </div>
            </div>
          </div>
        </aside>
      </main>
      
      <footer className="max-w-6xl mx-auto w-full px-6 py-10 border-t border-slate-100 mt-20">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">© 2025 G.C Mia Dental Clinic • Antipolo City</p>
          <div className="flex gap-4">
            <a href="#" className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-blue-500 hover:text-white transition-all"><i className="fab fa-facebook-f text-xs"></i></a>
            <a href="#" className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-blue-500 hover:text-white transition-all"><i className="fab fa-instagram text-xs"></i></a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
