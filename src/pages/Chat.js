import React, { useState, useEffect, useRef } from "react";
import ChatLayout from "../components/ChatLayout";
import InteractiveBranch2 from "../components/InteractiveBranches2";
import { db, auth } from "../firebase";
import { GoogleGenerativeAI } from "@google/generative-ai"; // Import Gemini SDK
import { speak } from "../tts"; // Import TTS function
import useSpeechToText from "../SpeechRecognition"; // Import Speech-to-Text hook
import {
    collection,
    addDoc,
    query,
    orderBy,
    onSnapshot,
    serverTimestamp,
    doc,
    updateDoc,
    deleteDoc
} from "firebase/firestore";

const Chat = () => {
    // State
    const [sessions, setSessions] = useState([]);
    const [currentSessionId, setCurrentSessionId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const [started, setStarted] = useState(false);
    const [ttsEnabled, setTtsEnabled] = useState(true); // TTS toggle state
    const [voiceLanguage, setVoiceLanguage] = useState('en-US'); // Default to English, can be changed

    const chatContainerRef = useRef(null);
    const inputRef = useRef(null);
    
    // Speech-to-Text hook with language support
    const { isListening, startListening, stopListening, error: sttError } = useSpeechToText(voiceLanguage);

    // Error handling for STT
    useEffect(() => {
        if (sttError) {
            alert(sttError);
        }
    }, [sttError]);

    // Handle voice input
    const handleVoiceInput = () => {
        if (isListening) {
            stopListening();
        } else {
            startListening((transcribedText) => {
                // Set the transcribed text in the input field
                setNewMessage(transcribedText);
                // Automatically send the message after a short delay
                setTimeout(() => {
                    handleSend(transcribedText);
                }, 300);
            });
        }
    };

    // 1. Listen for User's Sessions (Sidebar)
    useEffect(() => {
        const user = auth.currentUser;
        if (!user) return;

        const q = query(
            collection(db, "chats", user.uid, "sessions"),
            orderBy("updatedAt", "desc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const sess = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setSessions(sess);
        });

        return () => unsubscribe();
    }, []);

    // 2. Listen for Messages in Current Session
    useEffect(() => {
        const user = auth.currentUser;
        if (!user || !currentSessionId) {
            setMessages([]);
            setStarted(false);
            return;
        }

        setStarted(true); 

        const q = query(
            collection(db, "chats", user.uid, "sessions", currentSessionId, "messages"),
            orderBy("createdAt", "asc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setMessages(msgs);
        });

        return () => unsubscribe();
    }, [currentSessionId]);

    // Auto-scroll
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages, loading]);

    // Focus input
    useEffect(() => {
        if (started && inputRef.current) {
            inputRef.current.focus();
        }
    }, [started]);

    const createNewSession = async (firstMessageText) => {
        const user = auth.currentUser;
        if (!user) return null;

        try {
            const title = firstMessageText.slice(0, 30) + (firstMessageText.length > 30 ? "..." : "");
            const docRef = await addDoc(collection(db, "chats", user.uid, "sessions"), {
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                title: title
            });
            return docRef.id;
        } catch (error) {
            console.error("Error creating session:", error);
            return null;
        }
    };

    const deleteSession = async (sessionId) => {
        if (!window.confirm("Are you sure you want to delete this chat?")) return;

        try {
            const user = auth.currentUser;
            if (!user) return;

            await deleteDoc(doc(db, "chats", user.uid, "sessions", sessionId));

            if (currentSessionId === sessionId) {
                handleNewChat();
            }
        } catch (error) {
            console.error("Error deleting session:", error);
        }
    };

    const handleSend = async (textToSend = null) => {
        const messageText = textToSend || newMessage;
        if (messageText.trim() === "" || loading) return;

        const user = auth.currentUser;
        if (!user) {
            alert("You must be logged in to chat.");
            return;
        }

        const userText = messageText.trim();
        setNewMessage("");
        setLoading(true);
        
        // Stop listening if voice input is active
        if (isListening) {
            stopListening();
        }

        let sessionId = currentSessionId;

        try {
            // Create session if none exists
            if (!sessionId) {
                sessionId = await createNewSession(userText);
                if (!sessionId) throw new Error("Failed to create session");
                setCurrentSessionId(sessionId);
                setStarted(true);
            }

            // 1. Add user message to Firestore
            await addDoc(collection(db, "chats", user.uid, "sessions", sessionId, "messages"), {
                role: 'user',
                text: userText,
                createdAt: serverTimestamp()
            });

            // Update session timestamp
            await updateDoc(doc(db, "chats", user.uid, "sessions", sessionId), {
                updatedAt: serverTimestamp()
            });

            // --- CHANGED: DIRECT GEMINI CALL (No Fetch) ---
            
            // Initialize Gemini
            const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ 
                model: "gemini-2.5-flash",
                systemInstruction: "You are Mindsync, a friendly AI mental health companion for Indian users. Reply in natural Hinglish. Be empathetic and supportive. Use culturally relevant examples (Bollywood, cricket, festivals). Keep it short and simple."
            });

            // Format history for Gemini SDK
            const historyForGemini = messages.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.text }]
            }));

            // Start Chat
            const chat = model.startChat({
                history: historyForGemini,
            });

            // Get Response
            const result = await chat.sendMessage(userText);
            const responseText = result.response.text();

            // 2. Add model response to Firestore
            await addDoc(collection(db, "chats", user.uid, "sessions", sessionId, "messages"), {
                role: 'model',
                text: responseText,
                createdAt: serverTimestamp()
            });

            // Speak the AI response using TTS (if enabled)
            if (ttsEnabled) {
                speak(responseText);
            }

            // Update session timestamp again
            await updateDoc(doc(db, "chats", user.uid, "sessions", sessionId), {
                updatedAt: serverTimestamp()
            });

        } catch (err) {
            console.error("Error sending message:", err);
            
            // Create a backup error message in the chat
            if (sessionId) {
                await addDoc(collection(db, "chats", user.uid, "sessions", sessionId, "messages"), {
                    role: 'model',
                    text: 'Sorry, I am having trouble connecting right now. Please try again.',
                    createdAt: serverTimestamp()
                });
            }
        } finally {
            setLoading(false);
        }
    };

    const handleNewChat = () => {
        setCurrentSessionId(null);
        setMessages([]);
        setStarted(false);
        setNewMessage("");
        if (inputRef.current) inputRef.current.focus();
    };

    const SidebarContent = () => (
        <div className="flex flex-col h-full p-4">
            <div className="mb-6 space-y-3">
                <button
                    onClick={handleNewChat}
                    className="w-full flex items-center gap-2 px-4 py-3 bg-green-900 text-white rounded-xl hover:opacity-90 transition-all shadow-sm font-medium"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
                    New Chat
                </button>
                
                {/* TTS Toggle Button */}
                <button
                    onClick={() => setTtsEnabled(!ttsEnabled)}
                    className={`w-full flex items-center gap-2 px-4 py-3 rounded-xl transition-all shadow-sm font-medium ${
                        ttsEnabled 
                            ? 'bg-blue-600 text-white hover:bg-blue-700' 
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                    title={ttsEnabled ? "Voice output enabled - Click to disable" : "Voice output disabled - Click to enable"}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {ttsEnabled ? (
                            <path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                        ) : (
                            <path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" />
                        )}
                    </svg>
                    {ttsEnabled ? 'Voice ON' : 'Voice OFF'}
                </button>
                
                {/* Language Selector for Voice Input */}
                <div className="mt-3">
                    <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">Voice Language</label>
                    <select
                        value={voiceLanguage}
                        onChange={(e) => setVoiceLanguage(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                        disabled={isListening}
                    >
                        <option value="en-US">English (US)</option>
                        <option value="en-IN">English (India)</option>
                        <option value="hi-IN">Hindi (India)</option>
                        <option value="es-ES">Spanish (Spain)</option>
                        <option value="es-MX">Spanish (Mexico)</option>
                        <option value="fr-FR">French</option>
                        <option value="de-DE">German</option>
                        <option value="it-IT">Italian</option>
                        <option value="pt-BR">Portuguese (Brazil)</option>
                        <option value="ja-JP">Japanese</option>
                        <option value="ko-KR">Korean</option>
                        <option value="zh-CN">Chinese (Simplified)</option>
                        <option value="ar-SA">Arabic</option>
                    </select>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">Recent</h3>
                <div className="space-y-1 mt-2">
                    {sessions.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground italic">
                            No previous chats
                        </div>
                    ) : (
                        sessions.map(session => (
                            <div
                                key={session.id}
                                onClick={() => setCurrentSessionId(session.id)}
                                className={`group flex items-center justify-between px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${currentSessionId === session.id
                                    ? "bg-muted font-medium text-foreground"
                                    : "text-muted-foreground hover:bg-muted/50"
                                    }`}
                            >
                                <span className="truncate flex-1">{session.title || "Untitled Chat"}</span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        deleteSession(session.id);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-background rounded-md text-muted-foreground hover:text-destructive transition-all"
                                    title="Delete chat"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <ChatLayout sidebar={<SidebarContent />}>
            <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
                <InteractiveBranch2 />
            </div>
            <div className="relative z-10 max-w-4xl mx-auto w-full flex flex-col h-full px-4 md:px-6 pt-32 pb-4 md:pb-6">
                {/* Messages Area */}
                <div
                    ref={chatContainerRef}
                    className="flex-1 overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-sm mb-4 space-y-6 scroll-smooth"
                >
                    {!started ? (
                        <div className="h-full flex flex-col items-center justify-center text-center space-y-6 pb-20">
                            <h2 className="text-3xl font-bold tracking-tight">He<i>y</i> ! </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl w-full px-4">
                                {["Help me plan my day", "I'm feeling anxious", "Let's practice mindfulness", "Tell me a calming story"].map((suggestion, i) => (
                                    <button
                                        key={i}
                                        onClick={() => {
                                            setNewMessage(suggestion);
                                            setTimeout(() => {
                                                if (inputRef.current) inputRef.current.focus();
                                            }, 0);
                                        }}
                                        className="p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-muted/50 text-left text-sm transition-all group"
                                    >
                                        <span className="font-medium group-hover:text-primary transition-colors">{suggestion}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <>
                            {messages.map((msg, i) => (
                                <div key={i} className={`flex gap-4 max-w-3xl mx-auto ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    {msg.role === 'model' && (
                                        <div className="w-8 h-8 rounded-full bg-primary/10 flex-shrink-0 flex items-center justify-center mt-1">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M12 2a10 10 0 1 0 10 10H12V2z" /><path d="M12 2a10 10 0 0 1 10 10h-10V2z" /><path d="M12 12l9.33-5.83" /><path d="M12 12l-9.33-5.83" /></svg>
                                        </div>
                                    )}
                                    <div
                                        className={`relative px-5 py-3.5 rounded-2xl text-sm md:text-base leading-relaxed shadow-sm max-w-[85%] md:max-w-[75%] ${msg.role === 'user'
                                            ? 'bg-primary text-primary-foreground rounded-br-sm'
                                            : 'bg-card border border-border text-card-foreground rounded-bl-sm'
                                            }`}
                                    >
                                        {msg.text}
                                    </div>
                                    {msg.role === 'user' && (
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex-shrink-0 flex items-center justify-center mt-1 text-white text-xs font-bold">
                                            {msg.user}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {loading && (
                                <div className="flex gap-4 max-w-3xl mx-auto justify-start">
                                    <div className="w-8 h-8 rounded-full bg-primary/10 flex-shrink-0 flex items-center justify-center mt-1">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                                    </div>
                                    <div className="px-5 py-3.5 rounded-2xl bg-card border border-border text-muted-foreground text-sm shadow-sm rounded-bl-sm flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                        <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                        <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Input Area */}
                <div className="relative">
                    <div className="relative">
                        <input
                            ref={inputRef}
                            type="text"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder="Message Aspira... or click mic to speak"
                            className="w-full rounded-2xl py-4 pl-5 pr-28 bg-muted/50 border-transparent focus:bg-background border focus:border-primary/20 shadow-sm focus:shadow-md outline-none transition-all text-base placeholder:text-muted-foreground hover:shadow-[0_0_15px_rgba(22,163,74,0.3)] hover:border-green-600/40"
                            disabled={loading || isListening}
                        />
                        <div className="absolute top-1/2 -translate-y-1/2 right-2 flex gap-1">
                            {/* Voice Input Button */}
                            <button
                                onClick={handleVoiceInput}
                                disabled={loading}
                                className={`p-2 rounded-xl transition-all active:scale-95 ${
                                    isListening 
                                        ? 'bg-red-500 text-white animate-pulse' 
                                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                                }`}
                                aria-label={isListening ? "Stop recording" : "Start voice input"}
                                title={isListening ? "Click to stop recording" : "Click to speak"}
                            >
                                {isListening ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="6" y="6" width="12" height="12" rx="2" />
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                        <line x1="12" y1="19" x2="12" y2="23" />
                                        <line x1="8" y1="23" x2="16" y2="23" />
                                    </svg>
                                )}
                            </button>
                            {/* Send Button */}
                            <button
                                onClick={() => handleSend()}
                                disabled={loading || !newMessage.trim()}
                                className="p-2 rounded-xl bg-green-900 text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-all active:scale-95"
                                aria-label="Send"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                            </button>
                        </div>
                    </div>
                    <div className="text-center mt-2">
                        {isListening ? (
                            <div className="flex items-center justify-center gap-2">
                                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                                <p className="text-xs text-red-600 font-medium">Listening... Speak now</p>
                            </div>
                        ) : (
                            <p className="text-[10px] text-muted-foreground">Aspira can make mistakes. Consider checking important information.</p>
                        )}
                    </div>
                </div>
            </div>
        </ChatLayout >
    );
};

export default Chat;