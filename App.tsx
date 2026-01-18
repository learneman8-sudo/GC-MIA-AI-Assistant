
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

  // Critical check for Vercel deployment
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
      description: 'Trigger the background service to create a Google Calendar event and notify the coordinators.',
      properties: {
        clientName: { type: Type.STRING, description: 'Full name of the patient.' },
        appointmentDate: { type: Type.STRING, description: 'Date (YYYY-MM-DD).' },
        appointmentTime: { type: Type.STRING, description: 'Time (e.g., 4:30 PM).' },
        purpose: { type: Type.STRING, description: 'Reason for visit/service requested.' },
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
    if (!API_KEY) {
      setErrorMsg("API Key is missing. Please add API_KEY to Vercel Environment Variables.");
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
                text: "Please proactively greet the patient and introduce yourself as the G.C MIA Dental Clinic receptionist. Start the conversation in a warm Taglish tone." 
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
                        functionResponses: [{ id: fc.id, name: fc.name, response: { status: "success", confirmation: "Your booking is in our system." } }]
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
            setErrorMsg("Connection Error. Please check your network and API key.");
          },
          onclose: () => setStatus(ConnectionStatus.DISCONNECTED)
        },
        config: {
          responseModalities: [Modality.AUDIO],
          thinkingConfig: { thinkingBudget: 0 },
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          tools: [{ functionDeclarations: [bookAppointmentTool] }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are the professional Voice AI Receptionist for G.C MIA Dental Clinic.
          CLINIC INFO: Antipolo City, Rizal. Dr. Gloryner Mia-Dibaratun.
          Schedule: Mon–Thu (4PM-7PM), Sat (12PM-5PM), Sun (12PM-7PM). Friday is CLOSED.
          TONE: Warm Taglish.`
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
            <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
              <i className="fas fa-tooth text-2xl"></i>
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-xl tracking-tight">G.C MIA <span className="text-blue-600">DENTAL</span></h1>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">24/7 AI Receptionist</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10 flex flex-col lg:flex-row gap-10">
        <div className="flex-1 space-y-10">
          {errorMsg && (
            <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl text-rose-600 text-xs font-medium flex items-center gap-3 animate-pulse">
              <i className="fas fa-circle-exclamation text-lg"></i>
              {errorMsg}
            </div>
          )}

          {lastBooking && (
            <div className="animate-in zoom-in-95 duration-300 bg-emerald-50 border border-emerald-100 p-6 rounded-3xl flex items-center gap-5 shadow-sm text-emerald-900">
              <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center text-white shrink-0">
                <i className="fas fa-check text-xl"></i>
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-lg leading-tight">Booking confirmed!</h4>
                <p className="text-sm opacity-80">{lastBooking.name} on {lastBooking.date}</p>
              </div>
              <button onClick={() => setLastBooking(null)} className="p-2 hover:bg-emerald-100 rounded-full transition-colors"><i className="fas fa-times"></i></button>
            </div>
          )}

          <section className="glass-card rounded-[2rem] p-10 text-center relative overflow-hidden">
            <div className="relative z-10">
              <span className="inline-block py-1 px-3 bg-blue-50 text-blue-600 rounded-full text-[10px] font-bold uppercase tracking-widest mb-4">Voice Interface</span>
              <h2 className="text-4xl font-extrabold text-slate-900 mb-4 tracking-tight">Talk to Mia</h2>
              
              <div className="relative flex flex-col items-center justify-center my-12">
                <div className={`relative w-48 h-48 rounded-full flex flex-col items-center justify-center transition-all duration-700 ${
                  status === ConnectionStatus.CONNECTED ? 'bg-white shadow-xl ring-8 ring-blue-50 scale-105' : 'bg-slate-50 border-2 border-dashed border-slate-200'
                }`}>
                  {status === ConnectionStatus.CONNECTED ? (
                    <div className="flex flex-col items-center gap-4">
                      <VoiceVisualizer isActive={isAiSpeaking} color="bg-blue-500" />
                      <div className="h-px w-8 bg-slate-100"></div>
                      <VoiceVisualizer isActive={isUserSpeaking} color="bg-emerald-500" />
                    </div>
                  ) : (
                    <i className="fas fa-microphone-slash text-3xl text-slate-300"></i>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-4 max-w-xs mx-auto">
                <button
                  onClick={handleToggleConnection}
                  disabled={status === ConnectionStatus.CONNECTING}
                  className={`w-full py-5 rounded-2xl font-bold text-lg shadow-xl transition-all ${
                    status === ConnectionStatus.CONNECTED ? 'bg-rose-500 hover:bg-rose-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
                  } disabled:opacity-50`}
                >
                  {status === ConnectionStatus.CONNECTED ? 'End Session' : 'Start Conversation'}
                </button>
              </div>
            </div>
          </section>

          <DentalServices />
        </div>

        <aside className="lg:w-[400px]">
          <div className="glass-card rounded-[2rem] flex flex-col shadow-xl border-slate-100 h-[600px] overflow-hidden sticky top-28">
            <div className="p-6 border-b border-slate-100 bg-white/50 flex items-center justify-between">
              <span className="font-bold text-sm text-slate-800 tracking-tight">Transcript</span>
              <button onClick={() => setTranscriptions([])} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase">Clear</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {transcriptions.map((t, i) => (
                <div key={i} className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`text-[10px] font-bold mb-1 uppercase ${t.role === 'user' ? 'text-blue-500' : 'text-slate-400'}`}>
                    {t.role === 'user' ? 'You' : 'Mia'}
                  </div>
                  <div className={`max-w-[90%] p-4 rounded-2xl text-[13px] shadow-sm ${
                    t.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-slate-100 text-slate-700 rounded-tl-none'
                  }`}>
                    {t.text}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-6 border-t border-slate-100 bg-white">
              <div className="relative">
                <input 
                  type="text" 
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendText()}
                  placeholder="Type to Mia..."
                  disabled={status !== ConnectionStatus.CONNECTED}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all disabled:opacity-50"
                />
                <button 
                  onClick={() => handleSendText()}
                  disabled={status !== ConnectionStatus.CONNECTED || !textInput.trim()}
                  className="absolute right-2 top-2 w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center hover:bg-blue-700 disabled:bg-slate-300"
                >
                  <i className="fas fa-arrow-up text-sm"></i>
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
