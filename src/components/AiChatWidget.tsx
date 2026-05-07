"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc/client";
import type { ChatModule } from "@/server/services/gemini";

interface Message {
  role: "user" | "model";
  content: string;
}

interface AiChatWidgetProps {
  organizationId: string;
  module: ChatModule;
}

export function AiChatWidget({ organizationId, module: chatModule }: AiChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Check if AI is enabled for this org
  const { data: aiStatus, isLoading: checkingAi } = trpc.ai.isEnabled.useQuery(
    { organizationId },
    { retry: false, staleTime: 60_000 },
  );

  const chatMut = trpc.ai.chat.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "model", content: data.response }]);
      setIsTyping(false);
    },
    onError: (err) => {
      setMessages((prev) => [
        ...prev,
        { role: "model", content: `❌ Error: ${err.message}` },
      ]);
      setIsTyping(false);
    },
  });

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Focus input when chat opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Welcome message on first open
  const handleOpen = useCallback(() => {
    setOpen(true);
    if (messages.length === 0) {
      const greeting =
        chatModule === "commercial"
          ? "👋 Hola, soy tu asistente de IA para el centro comercial. Puedo consultarte datos de locales, arrendatarios, facturas y pagos en tiempo real. ¿En qué te ayudo?"
          : "👋 Hola, soy tu asistente de IA para el condominio. Puedo consultarte datos de residentes, unidades, facturas, pagos y gastos en tiempo real. ¿En qué te ayudo?";
      setMessages([{ role: "model", content: greeting }]);
    }
  }, [messages.length, chatModule]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isTyping) return;

    const newMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, newMsg]);
    setInput("");
    setIsTyping(true);

    chatMut.mutate({
      organizationId,
      module: chatModule,
      history: messages,
      message: text,
    });
  }, [input, isTyping, messages, organizationId, chatModule, chatMut]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  // Don't render if AI is not enabled or still checking
  if (checkingAi || !aiStatus?.enabled) return null;

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={handleOpen}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 hover:shadow-xl transition-all duration-200"
          title="Consultar al asistente de IA"
          aria-label="Abrir asistente de IA"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
          >
            <path d="M12 8V4H8" />
            <rect width="16" height="12" x="4" y="8" rx="2" />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M15 13v2" />
            <path d="M9 13v2" />
          </svg>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col w-[380px] max-w-[calc(100vw-2rem)] h-[520px] max-h-[calc(100vh-5rem)] rounded-2xl border border-border bg-background shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 bg-primary px-4 py-3 text-primary-foreground">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M12 8V4H8" />
                  <rect width="16" height="12" x="4" y="8" rx="2" />
                  <path d="M2 14h2" />
                  <path d="M20 14h2" />
                  <path d="M15 13v2" />
                  <path d="M9 13v2" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold leading-none">Asistente IA</p>
                <p className="text-xs text-primary-foreground/70">
                  {chatModule === "commercial" ? "Centro Comercial" : "Condominio"} · En línea
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setMessages([]); }}
                title="Nueva conversación"
                className="rounded p-1 hover:bg-white/20 transition-colors text-xs"
              >
                🔄
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 hover:bg-white/20 transition-colors"
                aria-label="Cerrar"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/20">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-background border border-border text-foreground rounded-bl-sm"
                  }`}
                  style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-background border border-border rounded-2xl rounded-bl-sm px-4 py-3">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="block h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggested prompts (only when conversation is fresh) */}
          {messages.length <= 1 && !isTyping && (
            <div className="px-3 py-2 border-t border-border bg-muted/10">
              <p className="text-xs text-muted-foreground mb-1.5">Sugerencias:</p>
              <div className="flex flex-wrap gap-1.5">
                {(chatModule === "commercial"
                  ? [
                      "¿Cuántos locales hay ocupados?",
                      "¿Quiénes deben más?",
                      "Facturas pendientes del mes",
                    ]
                  : [
                      "¿Cuánto se ha cobrado este mes?",
                      "¿Quiénes deben más?",
                      "Resumen financiero general",
                    ]
                ).map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      setInput(prompt);
                      inputRef.current?.focus();
                    }}
                    className="text-xs rounded-full border border-border bg-background px-2.5 py-1 hover:bg-accent/50 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="flex items-end gap-2 border-t border-border bg-background p-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribe tu consulta..."
              rows={1}
              disabled={isTyping}
              className="flex-1 resize-none rounded-xl border border-input bg-muted/30 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 max-h-[120px] overflow-y-auto"
              style={{ lineHeight: "1.5" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 120) + "px";
              }}
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim() || isTyping}
              className="flex-shrink-0 h-9 w-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Enviar"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
