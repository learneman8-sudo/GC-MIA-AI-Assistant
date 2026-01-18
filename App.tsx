
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

  // The API key must be obtained from process.env.API_KEY
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
      description: 'Notify the clinic of a new appointment request.',
      properties: {
        clientName: { type: Type.STRING, description: 'Full name of the patient.' },
        appointmentDate: { type: Type.STRING, description: 'Date (YYYY-MM-DD).' },
        appointmentTime: { type: Type.STRING, description: 'Time (e.g., 4:30 PM).' },
        purpose: { type: Type.STRING, description: 'Reason for visit.' },
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
    if (!API_KEY || API_KEY === "undefined") {
      setErrorMsg("Critical: API_KEY is missing. Add it to Vercel Project Settings > Environment Variables.");
      setStatus(ConnectionStatus.ERROR);
      return;
    }

    try {
      setStatus(ConnectionStatus.CONNECTING);
      setErrorMsg(null);

      // Initialize AI instance right before connection
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
                text: "Start by saying: 'Kumusta! I am Mia, your digital receptionist for G.C Mia Dental Clinic in Antipolo. How can I help you today?' in a warm Taglish tone." 
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
                    // Simulating backend call
                    await new Promise(r => setTimeout(r, 1500));
                    setLastBooking({ name: args.clientName, date: args.appointmentDate, time: args.appointmentTime });
                    sessionPromise.then((session) => {
                      session.sendToolResponse({
                        functionResponses: [{ id: fc.id, name: fc.name, response: { status: "success", info: "Booking submitted." } }]
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
            setErrorMsg("Mia is currently unavailable. Please check your connection or the Clinic's API configuration.");
          },
          onclose: () => setStatus(ConnectionStatus.DISCONNECTED)
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          tools: [{ functionDeclarations: [bookAppointmentTool] }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are Mia, the professional Voice AI Assistant for G.C Mia Dental Clinic.
          Location: Antipolo City. Dr. Gloryner Mia-Dibaratun. 
          Goal: Assist patients with bookings, pricing, and hours. 
          Tone: Warm, empathetic, clinical, and fluent in Taglish/English.
          Hours: Mon-Thu 4pm-7pm, Sat-Sun 12pm-7pm. Friday is CLOSED.`
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
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-20 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center text-white shadow-lg">
              <i className="fas fa-tooth text-2xl"></i>
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-xl tracking-tight">G.C MIA <span className="text-blue-600">DENTAL</span></h1>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Smart Receptionist</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10 flex flex-col lg:flex-row gap-10">
        <div className="flex-1 space-y-10">
          {errorMsg && (
            <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl text-rose-600 text-[11px] font-bold flex items-center gap-3">
              <i className="fas fa-exclamation-triangle text-lg"></i>
              {errorMsg}
            </div>
          )}

          {lastBooking && (
            <div className="bg-emerald-50 border border-emerald-100 p-6 rounded-3xl flex items-center gap-5 shadow-sm text-emerald-900">
              <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center text-white shrink-0">
                <i className="fas fa-calendar-check"></i>
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-sm">Booking Confirmed!</h4>
                <p className="text-[11px] opacity-80">{lastBooking.name} for {lastBooking.date}</p>
              </div>
              <button onClick={() => setLastBooking(null)} className="p-2 hover:bg-emerald-100 rounded-full"><i className="fas fa-times"></i></button>
            </div>
          )}

          <section className="glass-card rounded-[2rem] p-10 text-center relative">
            <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Speak to Mia</h2>
            <p className="text-slate-400 text-sm mb-10">Experience our digital clinic assistant in real-time.</p>
            
            <div className="flex flex-col items-center justify-center my-10">
              <div className={`w-40 h-40 rounded-full flex flex-col items-center justify-center transition-all ${
                status === ConnectionStatus.CONNECTED ? 'bg-white shadow-2xl ring-8 ring-blue-50' : 'bg-slate-50 border-2 border-dashed border-slate-200'
              }`}>
                {status === ConnectionStatus.CONNECTED ? (
                  <div className="flex flex-col items-center gap-3">
                    <VoiceVisualizer isActive={isAiSpeaking} color="bg-blue-500" />
                    <div className="h-px w-6 bg-slate-100"></div>
                    <VoiceVisualizer isActive={isUserSpeaking} color="bg-emerald-500" />
                  </div>
                ) : (
                  <i className="fas fa-microphone-slash text-3xl text-slate-200"></i>
                )}
              </div>
            </div>

            <button
              onClick={handleToggleConnection}
              disabled={status === ConnectionStatus.CONNECTING}
              className={`px-10 py-4 rounded-2xl font-bold text-sm shadow-xl transition-all ${
                status === ConnectionStatus.CONNECTED ? 'bg-rose-500 hover:bg-rose-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
              } disabled:opacity-50`}
            >
              {status === ConnectionStatus.CONNECTED ? 'Stop Assistant' : 'Start Assistant'}
            </button>
          </section>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {quickPrompts.map((p, i) => (
              <button 
                key={i}
                disabled={status !== ConnectionStatus.CONNECTED}
                onClick={() => handleSendText(p.text)}
                className="p-3 text-[10px] font-bold text-slate-500 bg-white border border-slate-100 rounded-xl hover:border-blue-300 hover:text-blue-600 transition-all disabled:opacity-30"
              >
                {p.label}
              </button>
            ))}
          </div>

          <DentalServices />
        </div>

        <aside className="lg:w-[380px]">
          <div className="glass-card rounded-[2rem] flex flex-col shadow-xl border-slate-100 h-[600px] overflow-hidden sticky top-28">
            <div className="p-5 border-b border-slate-100 bg-white/50">
              <span className="font-bold text-xs text-slate-400 uppercase tracking-widest">Conversation</span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
              {transcriptions.map((t, i) => (
                <div key={i} className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] p-4 rounded-2xl text-[12px] shadow-sm ${
                    t.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-slate-100 text-slate-600 rounded-tl-none'
                  }`}>
                    {t.text}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-5 border-t border-slate-100 bg-white">
              <div className="relative">
                <input 
                  type="text" 
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendText()}
                  placeholder="Type here..."
                  disabled={status !== ConnectionStatus.CONNECTED}
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-xs focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all disabled:opacity-50"
                />
                <button 
                  onClick={() => handleSendText()}
                  disabled={status !== ConnectionStatus.CONNECTED || !textInput.trim()}
                  className="absolute right-2 top-1.5 w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center hover:bg-blue-700 disabled:bg-slate-300"
                >
                  <i className="fas fa-arrow-up text-xs"></i>
                </button>
              </div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
};

export default App;
