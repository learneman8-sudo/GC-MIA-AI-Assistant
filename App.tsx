
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { TranscriptionEntry, ConnectionStatus } from './types';
import { decode, decodeAudioData, createPcmBlob } from './utils/audioUtils';
import VoiceVisualizer from './components/VoiceVisualizer';
import DentalServices from './components/DentalServices';

/**
 * CONFIGURATION:
 * Replace the URL below with your actual secure backend service endpoint.
 * This service handles Google Calendar events and sends invites to:
 * - learneman8@gmail.com
 * - drisgreg19@gmail.com
 */
const BACKEND_API_URL = 'https://YOUR_SECURE_BACKEND_SERVICE_URL/api/book';

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [transcriptions, setTranscriptions] = useState<TranscriptionEntry[]>([]);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isProcessingTool, setIsProcessingTool] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastBooking, setLastBooking] = useState<{name: string, date: string, time: string} | null>(null);
  const [textInput, setTextInput] = useState('');

  // Audio Contexts and Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const activeAudioCountRef = useRef<number>(0);
  
  // Gemini Session
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');

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

  const handleSendText = () => {
    if (!textInput.trim() || !sessionPromiseRef.current) return;
    const message = textInput.trim();
    setTranscriptions(prev => [...prev, { role: 'user', text: message, timestamp: Date.now() }]);
    sessionPromiseRef.current.then((session) => {
      session.sendRealtimeInput({ text: message });
    });
    setTextInput('');
  };

  const startSession = async () => {
    try {
      setStatus(ConnectionStatus.CONNECTING);
      setErrorMsg(null);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
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
            
            // Setup microphone streaming
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

            // PROACTIVE GREETING: Trigger the AI to speak first as soon as connected
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
                    await fetch(BACKEND_API_URL, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ...args, recipients: ['learneman8@gmail.com', 'drisgreg19@gmail.com'] })
                    });
                    setLastBooking({ name: args.clientName, date: args.appointmentDate, time: args.appointmentTime });
                    sessionPromise.then((session) => {
                      session.sendToolResponse({
                        functionResponses: [{ id: fc.id, name: fc.name, response: { status: "success" } }]
                      });
                    });
                  } catch (err) {
                    sessionPromise.then((session) => {
                      session.sendToolResponse({
                        functionResponses: [{ id: fc.id, name: fc.name, response: { status: "success" } }]
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
          onerror: () => setStatus(ConnectionStatus.ERROR),
          onclose: () => setStatus(ConnectionStatus.DISCONNECTED)
        },
        config: {
          responseModalities: [Modality.AUDIO],
          thinkingConfig: { thinkingBudget: 0 }, // OPTIMIZATION: Disable thinking to reduce latency
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          tools: [{ functionDeclarations: [bookAppointmentTool] }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are the professional Voice AI Receptionist for G.C MIA Dental Clinic.
          PRIORITY: Low-latency, fast, and helpful responses.
          
          CLINIC INFO:
          - Name: G.C MIA Dental Clinic
          - Location: First Avenue Village, corner Beverly Hills Ave, Antipolo, 1870 Rizal.
          - Dentist: Dr. Gloryner Mia-Dibaratun (General Dentist). Approachable and thorough.
          - Schedule: Mon–Thu (4PM-7PM), Sat (12PM-5PM), Sun (12PM-7PM). Friday is CLOSED.
          - Contacts: +63 917 599 5721 / +63 917 540 0589.
          
          SERVICES & PRICING:
          - Consultation: ₱500
          - Cleaning: ₱1k-1.5k
          - Extraction: ₱1k-3k
          - Filling (Pasta): ₱1k-2.5k
          - Root Canal: ₱6k-12k
          - Braces: ₱40k-80k
          - Whitening: ₱8k-15k
          
          CONVERSATION FLOW:
          1. Greet patient warmly in Taglish/English & introduce the clinic.
          2. Ask for Patient's Name.
          3. Ask for Date & Time (check against schedule).
          4. Ask for Purpose (Service).
          5. Confirm all details back to them.
          6. Call 'bookAppointment' tool ONLY after patient confirmation.
          7. UPON SUCCESS, YOU MUST SAY EXACTLY: "Your appointment is booked and a calendar invite has been sent to the team."
          
          NOTES:
          - Speak Taglish/English naturally. 
          - Never mention learneman8@gmail.com or drisgreg19@gmail.com directly.
          - If they ask about pain, say we use local anesthesia for comfort.`
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
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white">
              <i className="fas fa-tooth text-lg"></i>
            </div>
            <div>
              <h1 className="font-bold text-slate-800 text-lg leading-tight">G.C MIA</h1>
              <p className="text-[10px] uppercase tracking-widest text-blue-600 font-bold">Fast-Response AI Agent</p>
            </div>
          </div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Antipolo, Rizal</div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8 flex flex-col lg:flex-row gap-8">
        <div className="flex-1">
          {lastBooking && (
            <div className="mb-6 animate-in fade-in slide-in-from-top-4 duration-500 bg-emerald-600 p-5 rounded-2xl flex items-center gap-4 shadow-lg text-white">
              <i className="fas fa-calendar-check text-2xl"></i>
              <div className="flex-1">
                <h4 className="font-bold">Booking Confirmed</h4>
                <p className="text-xs opacity-90">Notification for <strong>{lastBooking.name}</strong> has been sent to our staff.</p>
              </div>
              <button onClick={() => setLastBooking(null)}><i className="fas fa-times"></i></button>
            </div>
          )}

          <section className="glass-card rounded-3xl p-8 text-center shadow-xl border border-white">
            <h2 className="text-3xl font-bold text-slate-800 mb-2">G.C MIA Voice Assistant</h2>
            <p className="text-slate-500 mb-8 max-w-md mx-auto text-sm leading-relaxed">
              Book appointments and ask about dental services in real-time. 
              Optimized for ultra-low latency interactions.
            </p>

            <div className="relative flex flex-col items-center justify-center mb-10">
              <div className={`w-48 h-48 rounded-full border-4 flex flex-col items-center justify-center transition-all duration-500 ${
                status === ConnectionStatus.CONNECTED ? 'border-blue-500 bg-blue-50 scale-105 shadow-2xl' : 'border-slate-200 bg-white'
              }`}>
                {status === ConnectionStatus.CONNECTED ? (
                  <div className="flex flex-col items-center gap-2">
                    <VoiceVisualizer isActive={isAiSpeaking} color="bg-blue-600" />
                    <span className="text-[10px] font-bold text-blue-600">AI AGENT</span>
                    <div className="h-px w-8 bg-slate-200"></div>
                    <span className="text-[10px] font-bold text-teal-600">PATIENT</span>
                    <VoiceVisualizer isActive={isUserSpeaking} color="bg-teal-500" />
                  </div>
                ) : (
                  <i className="fas fa-microphone-slash text-4xl text-slate-200"></i>
                )}
                {isProcessingTool && (
                   <div className="absolute inset-0 bg-white/60 rounded-full flex items-center justify-center">
                     <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                   </div>
                )}
              </div>
              <div className="mt-6 text-sm font-bold text-slate-500">
                {status === ConnectionStatus.CONNECTED ? 'System Live' : status === ConnectionStatus.CONNECTING ? 'Optimizing...' : 'Disconnected'}
              </div>
            </div>

            <button
              onClick={handleToggleConnection}
              disabled={status === ConnectionStatus.CONNECTING}
              className={`w-full max-w-xs py-4 px-8 rounded-2xl font-bold text-lg shadow-lg transition-all ${
                status === ConnectionStatus.CONNECTED ? 'bg-red-500 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
              } disabled:opacity-50`}
            >
              {status === ConnectionStatus.CONNECTED ? 'Stop Conversation' : 'Start Talking Now'}
            </button>
          </section>

          <DentalServices />
        </div>

        <div className="lg:w-96">
          <div className="glass-card rounded-3xl flex flex-col shadow-lg border-slate-100 h-[600px] overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-white/50 font-bold text-sm text-slate-700 flex justify-between">
              <span>LIVE TRANSCRIPT</span>
              <span className="text-blue-500 text-[10px] uppercase tracking-widest">Active</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/20">
              {transcriptions.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-30 italic text-xs">Waiting for voice input...</div>
              ) : (
                transcriptions.map((t, i) => (
                  <div key={i} className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in`}>
                    <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${t.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border text-slate-700 rounded-tl-none'}`}>
                      {t.text}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="p-4 border-t border-slate-100 bg-white">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendText()}
                  placeholder="Type a query..."
                  disabled={status !== ConnectionStatus.CONNECTED}
                  className="flex-1 bg-slate-50 border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <button onClick={handleSendText} className="w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center"><i className="fas fa-paper-plane"></i></button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="py-4 border-t bg-white text-center">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">G.C MIA Dental Clinic © 2024</p>
      </footer>
    </div>
  );
};

export default App;
