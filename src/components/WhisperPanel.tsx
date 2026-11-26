"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  CheckCheck,
  Copy,
  Download,
  FileText,
  Flame,
  Paperclip,
  Radio,
  RefreshCw,
  Reply,
  Search,
  Send,
  ShieldCheck,
  Smile,
  Trash2,
  User,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  computeSafetyFingerprint,
  decodeSignalToken,
  decryptWhisperCiphertext,
  deriveWhisperSessionKey,
  encodeSignalToken,
  encryptWhisperFrames,
  generateEphemeralEcdh,
  playSoftWhisperChime,
  waitForIceGathering,
  WhisperAttachment,
  WhisperPayload,
  WhisperReplyRef,
  WhisperWireFrame,
} from "@/lib/p2pWhisper";
import { clearSessionKeys, useSessionState } from "@/lib/sessionPersist";
import { CountdownText } from "./CountdownBadge";

interface WhisperPanelProps {
  onShowToast: (message: string) => void;
}

interface ChatEntry {
  id: string;
  sender: "me" | "peer";
  senderName: string;
  text: string;
  sentAt: number;
  burnAfterSec: number;
  expiresAt: number | null;
  status: "sent" | "delivered" | "read";
  replyTo?: WhisperReplyRef;
  attachment?: WhisperAttachment;
  reactions: Record<string, Array<"me" | "peer">>;
}

type ConnectionPhase =
  | "idle"
  | "awaiting-answer"
  | "joining"
  | "connected"
  | "closed";

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const WHISPER_SESSION_KEYS = [
  "ghostink.whisper.role",
  "ghostink.whisper.displayName",
  "ghostink.whisper.peerName",
  "ghostink.whisper.inviteToken",
  "ghostink.whisper.answerInput",
  "ghostink.whisper.remoteInvite",
  "ghostink.whisper.answerToken",
  "ghostink.whisper.fingerprint",
  "ghostink.whisper.messages",
  "ghostink.whisper.draft",
  "ghostink.whisper.burn",
  "ghostink.whisper.sound",
  "ghostink.whisper.wasConnected",
];

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "😮", "👀"] as const;
const COMPOSER_EMOJIS = [
  "😀",
  "😂",
  "❤️",
  "🔥",
  "👍",
  "👀",
  "🎉",
  "🔐",
  "👻",
  "✨",
] as const;

const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function WhisperPanel({ onShowToast }: WhisperPanelProps) {
  const [role, setRole] = useSessionState<"host" | "join">(
    "ghostink.whisper.role",
    "host"
  );
  const [displayName, setDisplayName] = useSessionState(
    "ghostink.whisper.displayName",
    "Ghost"
  );
  const [peerName, setPeerName] = useSessionState(
    "ghostink.whisper.peerName",
    "Peer"
  );
  const [phase, setPhase] = useState<ConnectionPhase>("idle");
  const [inviteToken, setInviteToken] = useSessionState(
    "ghostink.whisper.inviteToken",
    ""
  );
  const [answerInput, setAnswerInput] = useSessionState(
    "ghostink.whisper.answerInput",
    ""
  );
  const [remoteInviteInput, setRemoteInviteInput] = useSessionState(
    "ghostink.whisper.remoteInvite",
    ""
  );
  const [answerToken, setAnswerToken] = useSessionState(
    "ghostink.whisper.answerToken",
    ""
  );
  const [fingerprint, setFingerprint] = useSessionState<string | null>(
    "ghostink.whisper.fingerprint",
    null
  );
  const [wasConnected, setWasConnected] = useSessionState(
    "ghostink.whisper.wasConnected",
    false
  );
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const [messages, setMessages] = useSessionState<ChatEntry[]>(
    "ghostink.whisper.messages",
    []
  );
  const [draft, setDraft] = useSessionState("ghostink.whisper.draft", "");
  const [burnAfterSec, setBurnAfterSec] = useSessionState<number>(
    "ghostink.whisper.burn",
    0
  );
  const [soundEnabled, setSoundEnabled] = useSessionState<boolean>(
    "ghostink.whisper.sound",
    true
  );

  const [peerTyping, setPeerTyping] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatEntry | null>(null);
  const [pendingAttachment, setPendingAttachment] =
    useState<WhisperAttachment | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(
    null
  );
  const [copiedToken, setCopiedToken] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const sessionKeyRef = useRef<CryptoKey | null>(null);
  const ecdhRef = useRef<{
    keyPair: CryptoKeyPair;
    publicJwk: JsonWebKey;
  } | null>(null);
  const chunkBuffersRef = useRef<
    Map<string, { iv: string; total: number; slices: Array<string | undefined> }>
  >(new Map());
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const displayNameRef = useRef(displayName);
  const soundEnabledRef = useRef(soundEnabled);

  useEffect(() => {
    displayNameRef.current = displayName;
  }, [displayName]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const sendPayload = useCallback(async (payload: WhisperPayload) => {
    const dc = dcRef.current;
    const key = sessionKeyRef.current;
    if (!dc || dc.readyState !== "open" || !key) return;

    const frames = await encryptWhisperFrames(key, payload);
    for (const frame of frames) {
      dc.send(JSON.stringify(frame));
    }
  }, []);

  const closeTransportOnly = () => {
    dcRef.current?.close();
    pcRef.current?.close();
    dcRef.current = null;
    pcRef.current = null;
    sessionKeyRef.current = null;
    ecdhRef.current = null;
    chunkBuffersRef.current.clear();
  };

  const wipeSession = () => {
    closeTransportOnly();
    setPhase("idle");
    setPeerTyping(false);
    setReplyingTo(null);
    setPendingAttachment(null);
    setShowSearch(false);
    setSearchQuery("");
    setError(null);
    clearSessionKeys(WHISPER_SESSION_KEYS);
  };

  useEffect(() => {
    return () => {
      if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
      if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
      dcRef.current?.close();
      pcRef.current?.close();
    };
  }, []);

  // Warn before accidental reload while WebRTC tunnel is live
  useEffect(() => {
    if (phase !== "connected") return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [phase]);

  // Re-arm RAM burn timers across page refreshes
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const now = Date.now();

    for (const msg of messages) {
      if (msg.expiresAt !== null) {
        const remaining = Math.max(0, msg.expiresAt - now);
        const t = setTimeout(() => {
          setMessages((prev) => prev.filter((item) => item.id !== msg.id));
        }, remaining);
        timers.push(t);
      }
    }

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [messages, setMessages]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, peerTyping]);

  const handleIncomingPayload = useCallback(
    (payload: WhisperPayload) => {
      if (payload.type === "hello") {
        setPeerName(payload.displayName || "Peer");
        return;
      }

      if (payload.type === "typing") {
        setPeerTyping(payload.isTyping);
        if (peerTypingTimerRef.current) {
          clearTimeout(peerTypingTimerRef.current);
        }
        if (payload.isTyping) {
          peerTypingTimerRef.current = setTimeout(() => {
            setPeerTyping(false);
          }, 3000);
        }
        return;
      }

      if (payload.type === "ack") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === payload.messageId
              ? {
                  ...m,
                  status:
                    payload.status === "read" || m.status === "read"
                      ? "read"
                      : "delivered",
                }
              : m
          )
        );
        return;
      }

      if (payload.type === "reaction") {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== payload.messageId) return m;
            const current = m.reactions[payload.emoji] ?? [];
            const who: "me" | "peer" = "peer";
            const exists = current.includes(who);
            const updated = exists
              ? current.filter((r) => r !== who)
              : [...current, who];
            const nextReactions = { ...m.reactions };
            if (updated.length > 0) {
              nextReactions[payload.emoji] = updated;
            } else {
              delete nextReactions[payload.emoji];
            }
            return { ...m, reactions: nextReactions };
          })
        );
        return;
      }

      if (payload.type === "delete") {
        setMessages((prev) => prev.filter((m) => m.id !== payload.messageId));
        return;
      }

      if (payload.type === "chat") {
        setPeerTyping(false);
        const expiresAt =
          payload.burnAfterSec > 0
            ? Date.now() + payload.burnAfterSec * 1000
            : null;

        setMessages((prev) => {
          if (prev.some((m) => m.id === payload.id)) return prev;
          return [
            ...prev,
            {
              id: payload.id,
              sender: "peer",
              senderName: payload.senderName || "Peer",
              text: payload.text,
              sentAt: payload.sentAt,
              burnAfterSec: payload.burnAfterSec,
              expiresAt,
              status: "read",
              replyTo: payload.replyTo,
              attachment: payload.attachment,
              reactions: {},
            },
          ];
        });

        if (soundEnabledRef.current) {
          playSoftWhisperChime();
        }

        // Send encrypted delivered + read receipt
        void sendPayload({
          type: "ack",
          messageId: payload.id,
          status: "delivered",
        }).then(() =>
          sendPayload({
            type: "ack",
            messageId: payload.id,
            status: "read",
          })
        );
      }
    },
    [sendPayload, setMessages, setPeerName]
  );

  const attachDataChannel = (channel: RTCDataChannel) => {
    dcRef.current = channel;
    channel.onopen = () => {
      setPhase("connected");
      setWasConnected(true);
      setError(null);
      onShowToast("E2EE WebRTC channel open");
      void sendPayload({
        type: "hello",
        displayName: displayNameRef.current.trim() || "Ghost",
      });
    };
    channel.onclose = () => {
      setPhase("closed");
      setPeerTyping(false);
    };
    channel.onmessage = async (event) => {
      const key = sessionKeyRef.current;
      if (!key) return;
      try {
        const frame = JSON.parse(String(event.data)) as WhisperWireFrame;
        if (frame.kind === "single") {
          const payload = await decryptWhisperCiphertext(
            key,
            frame.iv,
            frame.ct
          );
          handleIncomingPayload(payload);
          return;
        }

        if (frame.kind === "chunk") {
          let entry = chunkBuffersRef.current.get(frame.transferId);
          if (!entry) {
            entry = {
              iv: frame.iv,
              total: frame.total,
              slices: new Array<string | undefined>(frame.total),
            };
            chunkBuffersRef.current.set(frame.transferId, entry);
          }
          entry.slices[frame.index] = frame.slice;

          if (entry.slices.every((s) => typeof s === "string")) {
            chunkBuffersRef.current.delete(frame.transferId);
            const fullCt = entry.slices.join("");
            const payload = await decryptWhisperCiphertext(
              key,
              entry.iv,
              fullCt
            );
            handleIncomingPayload(payload);
          }
        }
      } catch {
        setError("Failed to authenticate incoming encrypted whisper packet.");
      }
    };
  };

  const handleCreateRoom = async () => {
    setError(null);
    setIsWorking(true);
    closeTransportOnly();

    try {
      const ecdh = await generateEphemeralEcdh();
      ecdhRef.current = ecdh;

      const pc = new RTCPeerConnection(ICE_CONFIG);
      pcRef.current = pc;

      const dc = pc.createDataChannel("ghostink-whisper", { ordered: true });
      attachDataChannel(dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

      if (!pc.localDescription) {
        throw new Error("Failed to gather local WebRTC offer.");
      }

      const token = encodeSignalToken({
        kind: "invite",
        sdp: pc.localDescription,
        pubKeyJwk: ecdh.publicJwk,
        displayName: displayName.trim() || "Ghost",
      });

      setInviteToken(token);
      setAnswerToken("");
      setWasConnected(false);
      setPhase("awaiting-answer");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to initialize WebRTC room."
      );
      closeTransportOnly();
    } finally {
      setIsWorking(false);
    }
  };

  const handleAcceptAnswer = async () => {
    setError(null);
    setIsWorking(true);

    try {
      const pc = pcRef.current;
      const ecdh = ecdhRef.current;
      if (!pc || !ecdh) {
        throw new Error(
          "Your WebRTC offer reset on page reload. Click Generate Invite Token to re-pair."
        );
      }

      const envelope = decodeSignalToken(answerInput, "answer");
      if (envelope.displayName) setPeerName(envelope.displayName);
      sessionKeyRef.current = await deriveWhisperSessionKey(
        ecdh.keyPair.privateKey,
        envelope.pubKeyJwk
      );
      const fp = await computeSafetyFingerprint(
        ecdh.publicJwk,
        envelope.pubKeyJwk
      );
      setFingerprint(fp);
      await pc.setRemoteDescription(envelope.sdp);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Invalid peer answer token."
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleJoinRoom = async () => {
    setError(null);
    setIsWorking(true);
    closeTransportOnly();

    try {
      const invite = decodeSignalToken(remoteInviteInput, "invite");
      if (invite.displayName) setPeerName(invite.displayName);
      const ecdh = await generateEphemeralEcdh();
      ecdhRef.current = ecdh;

      sessionKeyRef.current = await deriveWhisperSessionKey(
        ecdh.keyPair.privateKey,
        invite.pubKeyJwk
      );
      const fp = await computeSafetyFingerprint(
        ecdh.publicJwk,
        invite.pubKeyJwk
      );
      setFingerprint(fp);

      const pc = new RTCPeerConnection(ICE_CONFIG);
      pcRef.current = pc;
      pc.ondatachannel = (event) => {
        attachDataChannel(event.channel);
      };

      await pc.setRemoteDescription(invite.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc);

      if (!pc.localDescription) {
        throw new Error("Failed to gather local WebRTC answer.");
      }

      const token = encodeSignalToken({
        kind: "answer",
        sdp: pc.localDescription,
        pubKeyJwk: ecdh.publicJwk,
        displayName: displayName.trim() || "Ghost",
      });

      setAnswerToken(token);
      setWasConnected(false);
      setPhase("joining");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to join WebRTC room."
      );
      closeTransportOnly();
    } finally {
      setIsWorking(false);
    }
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (phase !== "connected") return;

    void sendPayload({ type: "typing", isTyping: value.trim().length > 0 });
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = setTimeout(() => {
      void sendPayload({ type: "typing", isTyping: false });
    }, 1800);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      setError("Attachment exceeds 4 MB limit.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPendingAttachment({
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          dataUrl: reader.result,
        });
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const dc = dcRef.current;
    const key = sessionKeyRef.current;
    if (!dc || dc.readyState !== "open" || !key) return;
    if (!draft.trim().length && !pendingAttachment) return;

    const text = draft.trim();
    const msgId = crypto.randomUUID();
    const sentAt = Date.now();
    const senderName = displayName.trim() || "Ghost";
    const replyRef: WhisperReplyRef | undefined = replyingTo
      ? {
          id: replyingTo.id,
          senderName:
            replyingTo.sender === "me" ? senderName : replyingTo.senderName,
          excerpt:
            replyingTo.text ||
            (replyingTo.attachment ? `📎 ${replyingTo.attachment.name}` : ""),
        }
      : undefined;

    try {
      await sendPayload({
        type: "chat",
        id: msgId,
        text,
        sentAt,
        burnAfterSec,
        senderName,
        replyTo: replyRef,
        attachment: pendingAttachment ?? undefined,
      });

      void sendPayload({ type: "typing", isTyping: false });

      const expiresAt =
        burnAfterSec > 0 ? Date.now() + burnAfterSec * 1000 : null;
      setMessages((prev) => [
        ...prev,
        {
          id: msgId,
          sender: "me",
          senderName,
          text,
          sentAt,
          burnAfterSec,
          expiresAt,
          status: "sent",
          replyTo: replyRef,
          attachment: pendingAttachment ?? undefined,
          reactions: {},
        },
      ]);

      setDraft("");
      setReplyingTo(null);
      setPendingAttachment(null);
      setShowEmojiPicker(false);
    } catch {
      setError("Failed to encrypt and transmit message.");
    }
  };

  const handleToggleReaction = (messageId: string, emoji: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const current = m.reactions[emoji] ?? [];
        const exists = current.includes("me");
        const updated = exists
          ? current.filter((r) => r !== "me")
          : [...current, "me" as const];
        const nextReactions = { ...m.reactions };
        if (updated.length > 0) {
          nextReactions[emoji] = updated;
        } else {
          delete nextReactions[emoji];
        }
        return { ...m, reactions: nextReactions };
      })
    );
    setActiveReactionMsgId(null);

    if (phase === "connected") {
      void sendPayload({
        type: "reaction",
        messageId,
        emoji,
        reactor: "me",
      });
    }
  };

  const handleUnsendMessage = (messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    if (phase === "connected") {
      void sendPayload({ type: "delete", messageId });
    }
    onShowToast("Message unsent");
  };

  const copyToken = async (token: string, label: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedToken(true);
      onShowToast(`${label} copied`);
      setTimeout(() => setCopiedToken(false), 1800);
    } catch {
      onShowToast("Clipboard permission denied");
    }
  };

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter(
      (m) =>
        m.text.toLowerCase().includes(q) ||
        m.attachment?.name.toLowerCase().includes(q) ||
        m.senderName.toLowerCase().includes(q)
    );
  }, [messages, searchQuery]);

  const hasSavedTranscript = messages.length > 0;
  const reloadedMidSession = phase === "idle" && (wasConnected || hasSavedTranscript);

  return (
    <div className="space-y-5">
      {/* Header Row: Title, Nickname & Session Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white tracking-tight">
            Serverless P2P Whisper (WebRTC + ECDH P-256)
          </h2>
          <p className="text-xs text-white/50">
            End-to-end encrypted chat with receipts, reactions, replies, files &amp; auto-burn.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Local Display Name */}
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3 py-1">
            <User className="w-3 h-3 text-white/50" />
            <input
              type="text"
              value={displayName}
              onChange={(e) => {
                const next = e.target.value;
                setDisplayName(next);
                if (phase === "connected") {
                  void sendPayload({
                    type: "hello",
                    displayName: next.trim() || "Ghost",
                  });
                }
              }}
              maxLength={18}
              aria-label="Your display name"
              className="w-20 bg-transparent text-xs font-mono text-white focus:outline-none"
            />
          </div>

          {phase === "idle" && !reloadedMidSession ? (
            <div className="inline-flex rounded-full bg-white/5 border border-white/10 p-1">
              <button
                type="button"
                onClick={() => {
                  setRole("host");
                  setError(null);
                }}
                className={`px-3.5 py-1 rounded-full text-xs font-mono transition-all cursor-pointer ${
                  role === "host"
                    ? "bg-white text-black font-semibold"
                    : "text-white/65 hover:text-white"
                }`}
              >
                Create Room
              </button>
              <button
                type="button"
                onClick={() => {
                  setRole("join");
                  setError(null);
                }}
                className={`px-3.5 py-1 rounded-full text-xs font-mono transition-all cursor-pointer ${
                  role === "join"
                    ? "bg-white text-black font-semibold"
                    : "text-white/65 hover:text-white"
                }`}
              >
                Join Room
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                wipeSession();
                onShowToast("Ephemeral session wiped from memory");
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-xs font-mono text-rose-200 hover:bg-rose-500/25 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Wipe
            </button>
          )}
        </div>
      </div>

      {/* Reload / Reconnect Notice */}
      {reloadedMidSession && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="space-y-0.5 text-amber-200">
            <p className="font-medium">
              Chat history preserved across refresh ({messages.length}{" "}
              {messages.length === 1 ? "message" : "messages"}).
            </p>
            <p className="text-amber-200/75 font-mono text-[11px]">
              Browsers close live WebRTC sockets on reload—re-pair below to continue sending.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setWasConnected(false);
              setInviteToken("");
              setAnswerToken("");
              setAnswerInput("");
              setRemoteInviteInput("");
              setFingerprint(null);
              setError(null);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-black font-semibold text-[11px] cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            Re-Pair Peer
          </button>
        </div>
      )}

      {/* Handshake UI */}
      {phase !== "connected" && !reloadedMidSession && (
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5 space-y-4">
          {role === "host" ? (
            phase === "idle" ? (
              <div className="space-y-3">
                <p className="text-xs text-white/65 leading-relaxed">
                  1. Generate an ephemeral ECDH P-256 + WebRTC invite token.
                  <br />
                  2. Share it with your peer; paste their answer token to start chatting.
                </p>
                <button
                  type="button"
                  onClick={handleCreateRoom}
                  disabled={isWorking}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-black text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-50"
                >
                  <Radio className="w-4 h-4" />
                  {isWorking ? "Gathering ICE + ECDH..." : "Generate Invite Token"}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-300">
                      Step 1 • Share Invite Token with Peer
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToken(inviteToken, "Invite token")}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white text-black text-[11px] font-semibold cursor-pointer"
                    >
                      {copiedToken ? (
                        <>
                          <Check className="w-3 h-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy Invite
                        </>
                      )}
                    </button>
                  </div>
                  <textarea
                    readOnly
                    rows={3}
                    value={inviteToken}
                    className="w-full rounded-xl bg-black/60 border border-white/10 p-3 text-[11px] font-mono text-white/80 select-all"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="whisper-answer-in"
                    className="block text-[11px] font-mono uppercase tracking-wider text-white/65"
                  >
                    Step 2 • Paste Peer Answer Token
                  </label>
                  <textarea
                    id="whisper-answer-in"
                    rows={3}
                    value={answerInput}
                    onChange={(e) => setAnswerInput(e.target.value)}
                    placeholder="GHOST-ANSWER-..."
                    className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-[11px] font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-white/35"
                  />
                  <button
                    type="button"
                    onClick={handleAcceptAnswer}
                    disabled={isWorking || !answerInput.trim().length}
                    className="px-6 py-2.5 rounded-full bg-white text-black text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-40"
                  >
                    Connect P2P Tunnel
                  </button>
                </div>
              </div>
            )
          ) : phase === "idle" ? (
            <div className="space-y-3">
              <label
                htmlFor="whisper-invite-in"
                className="block text-[11px] font-mono uppercase tracking-wider text-white/65"
              >
                Paste Host Invite Token
              </label>
              <textarea
                id="whisper-invite-in"
                rows={3}
                value={remoteInviteInput}
                onChange={(e) => setRemoteInviteInput(e.target.value)}
                placeholder="GHOST-INVITE-..."
                className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-[11px] font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-white/35"
              />
              <button
                type="button"
                onClick={handleJoinRoom}
                disabled={isWorking || !remoteInviteInput.trim().length}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-black text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-40"
              >
                <Radio className="w-4 h-4" />
                {isWorking ? "Deriving ECDH Key..." : "Generate Answer Token"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-300">
                  Send This Answer Token Back to Host
                </span>
                <button
                  type="button"
                  onClick={() => copyToken(answerToken, "Answer token")}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white text-black text-[11px] font-semibold cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  Copy Answer
                </button>
              </div>
              <textarea
                readOnly
                rows={3}
                value={answerToken}
                className="w-full rounded-xl bg-black/60 border border-white/10 p-3 text-[11px] font-mono text-white/80 select-all"
              />
              <p className="text-xs font-mono text-white/50">
                Waiting for host to apply your answer token and open the tunnel...
              </p>
            </div>
          )}
        </div>
      )}

      {/* Safety Fingerprint Banner */}
      {fingerprint && (
        <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-2 text-emerald-200">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>
              {phase === "connected"
                ? `Encrypted Tunnel • Connected with ${peerName}`
                : reloadedMidSession
                  ? `Saved Transcript (${peerName})`
                  : `ECDH Key Ready (${peerName})`}
            </span>
          </div>
          <span className="text-white/80">
            Safety: <strong>{fingerprint}</strong>
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-sm text-rose-200">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Chat Room Interface */}
      {(phase === "connected" || hasSavedTranscript) && (
        <div className="rounded-3xl bg-black/55 border border-white/15 p-4 sm:p-5 space-y-3.5">
          {/* Chat Toolbar: Burn Timer, Search, Sound Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-mono text-white/55 mr-1">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                Burn:
              </span>
              {[
                { label: "Off", sec: 0 },
                { label: "15s", sec: 15 },
                { label: "30s", sec: 30 },
                { label: "60s", sec: 60 },
                { label: "5m", sec: 300 },
              ].map((opt) => (
                <button
                  key={opt.sec}
                  type="button"
                  onClick={() => setBurnAfterSec(opt.sec)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono border cursor-pointer transition-colors ${
                    burnAfterSec === opt.sec
                      ? "bg-white text-black border-white font-semibold"
                      : "bg-white/5 text-white/60 border-white/10 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Search messages"
                onClick={() => setShowSearch((prev) => !prev)}
                className={`p-1.5 rounded-full border transition-colors cursor-pointer ${
                  showSearch
                    ? "bg-white text-black border-white"
                    : "bg-white/5 text-white/65 border-white/10 hover:text-white"
                }`}
              >
                <Search className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label={soundEnabled ? "Mute notifications" : "Enable sound"}
                onClick={() => setSoundEnabled((prev) => !prev)}
                className="p-1.5 rounded-full bg-white/5 border border-white/10 text-white/65 hover:text-white transition-colors cursor-pointer"
              >
                {soundEnabled ? (
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5 text-white/45" />
                )}
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <AnimatePresence>
            {showSearch && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter encrypted messages..."
                    className="w-full rounded-xl bg-white/5 border border-white/10 pl-3.5 pr-9 py-2 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-white/30"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/50 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Messages Viewport */}
          <div className="min-h-[220px] max-h-[360px] overflow-y-auto subtle-scroll space-y-3 pr-1">
            {filteredMessages.length === 0 ? (
              <p className="text-xs font-mono text-white/35 text-center py-14">
                {searchQuery
                  ? "No messages match your search."
                  : "Ephemeral AES-256-GCM chat ready. Send text, files, replies, or reactions."}
              </p>
            ) : (
              filteredMessages.map((msg) => {
                const reactionEntries = Object.entries(msg.reactions);
                const isImage =
                  msg.attachment?.mimeType.startsWith("image/") ?? false;

                return (
                  <div
                    key={msg.id}
                    className={`group flex flex-col ${
                      msg.sender === "me" ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`relative max-w-[85%] sm:max-w-[76%] rounded-2xl px-3.5 py-2.5 text-sm ${
                        msg.sender === "me"
                          ? "bg-white text-black"
                          : "bg-white/10 border border-white/15 text-white"
                      }`}
                    >
                      {/* Sender header for peer */}
                      {msg.sender === "peer" && (
                        <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-300/90 mb-1">
                          {msg.senderName}
                        </p>
                      )}

                      {/* Quoted Reply */}
                      {msg.replyTo && (
                        <div
                          className={`mb-2 rounded-xl px-2.5 py-1.5 border-l-2 text-xs ${
                            msg.sender === "me"
                              ? "bg-black/10 border-black/40 text-black/75"
                              : "bg-black/35 border-emerald-400/70 text-white/75"
                          }`}
                        >
                          <p className="font-mono text-[10px] font-semibold">
                            {msg.replyTo.senderName}
                          </p>
                          <p className="truncate">{msg.replyTo.excerpt}</p>
                        </div>
                      )}

                      {/* Attachment */}
                      {msg.attachment && (
                        <div className="mb-2">
                          {isImage ? (
                            <div className="space-y-1.5">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={msg.attachment.dataUrl}
                                alt={msg.attachment.name}
                                className="max-h-52 rounded-xl border border-black/15 object-contain"
                              />
                              <a
                                href={msg.attachment.dataUrl}
                                download={msg.attachment.name}
                                className={`inline-flex items-center gap-1 text-[10px] font-mono underline ${
                                  msg.sender === "me"
                                    ? "text-black/70"
                                    : "text-white/70"
                                }`}
                              >
                                <Download className="w-3 h-3" />
                                {msg.attachment.name} (
                                {formatBytes(msg.attachment.size)})
                              </a>
                            </div>
                          ) : (
                            <a
                              href={msg.attachment.dataUrl}
                              download={msg.attachment.name}
                              className={`flex items-center gap-2.5 rounded-xl px-3 py-2 border ${
                                msg.sender === "me"
                                  ? "bg-black/10 border-black/15 text-black"
                                  : "bg-black/40 border-white/15 text-white"
                              }`}
                            >
                              <FileText className="w-4 h-4 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">
                                  {msg.attachment.name}
                                </p>
                                <p className="text-[10px] font-mono opacity-65">
                                  {formatBytes(msg.attachment.size)}
                                </p>
                              </div>
                              <Download className="w-3.5 h-3.5 shrink-0" />
                            </a>
                          )}
                        </div>
                      )}

                      {/* Message Text */}
                      {msg.text && (
                        <p className="whitespace-pre-wrap break-words leading-relaxed">
                          {msg.text}
                        </p>
                      )}

                      {/* Meta Row: Time, Burn, Delivery/Read Ticks */}
                      <div
                        className={`flex items-center justify-end gap-1.5 text-[10px] font-mono mt-1 ${
                          msg.sender === "me" ? "text-black/55" : "text-white/45"
                        }`}
                      >
                        {msg.expiresAt !== null && (
                          <span className="inline-flex items-center gap-0.5 text-amber-500 font-semibold">
                            🔥 <CountdownText expiresAt={msg.expiresAt} expiredLabel="0s" /> •
                          </span>
                        )}
                        <span>
                          {new Date(msg.sentAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {msg.sender === "me" && (
                          <span className="inline-flex items-center">
                            {msg.status === "sent" && (
                              <Check className="w-3 h-3" />
                            )}
                            {msg.status === "delivered" && (
                              <CheckCheck className="w-3 h-3" />
                            )}
                            {msg.status === "read" && (
                              <CheckCheck className="w-3 h-3 text-emerald-600" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Reactions & Hover Actions */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 px-1">
                      {reactionEntries.map(([emoji, reactors]) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => handleToggleReaction(msg.id, emoji)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] cursor-pointer ${
                            reactors.includes("me")
                              ? "bg-white/15 border-white/30 text-white"
                              : "bg-white/5 border-white/10 text-white/75"
                          }`}
                        >
                          <span>{emoji}</span>
                          <span className="font-mono text-[10px]">
                            {reactors.length}
                          </span>
                        </button>
                      ))}

                      {/* Action Buttons */}
                      <div className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity inline-flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="React to message"
                          onClick={() =>
                            setActiveReactionMsgId((prev) =>
                              prev === msg.id ? null : msg.id
                            )
                          }
                          className="p-1 rounded-full hover:bg-white/10 text-white/55 hover:text-white cursor-pointer"
                        >
                          <Smile className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="Reply to message"
                          onClick={() => setReplyingTo(msg)}
                          className="p-1 rounded-full hover:bg-white/10 text-white/55 hover:text-white cursor-pointer"
                        >
                          <Reply className="w-3 h-3" />
                        </button>
                        {msg.sender === "me" && (
                          <button
                            type="button"
                            aria-label="Unsend message"
                            onClick={() => handleUnsendMessage(msg.id)}
                            className="p-1 rounded-full hover:bg-rose-500/20 text-white/50 hover:text-rose-300 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Quick Reaction Picker */}
                    {activeReactionMsgId === msg.id && (
                      <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-neutral-900 border border-white/15 px-2.5 py-1 shadow-xl">
                        {QUICK_REACTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => handleToggleReaction(msg.id, emoji)}
                            className="text-sm hover:scale-125 transition-transform px-1 cursor-pointer"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Peer Typing Indicator */}
            {peerTyping && (
              <div className="flex items-center gap-2 text-xs font-mono text-white/55 pl-1">
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:120ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:240ms]" />
                </span>
                <span>{peerName} is typing...</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Pending Reply or Attachment Previews */}
          {(replyingTo || pendingAttachment) && (
            <div className="space-y-2 pt-1">
              {replyingTo && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <span className="font-mono text-[10px] text-emerald-300 uppercase">
                      Replying to{" "}
                      {replyingTo.sender === "me"
                        ? displayName
                        : replyingTo.senderName}
                    </span>
                    <p className="text-white/75 truncate">
                      {replyingTo.text ||
                        (replyingTo.attachment
                          ? `📎 ${replyingTo.attachment.name}`
                          : "")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    className="p-1 text-white/50 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {pendingAttachment && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-white/5 border border-white/15 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="truncate text-white">
                      {pendingAttachment.name}
                    </span>
                    <span className="font-mono text-[10px] text-white/50">
                      ({formatBytes(pendingAttachment.size)})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingAttachment(null)}
                    className="p-1 text-white/50 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Emoji Picker Popover */}
          {showEmojiPicker && (
            <div className="flex flex-wrap gap-1.5 rounded-2xl bg-neutral-900 border border-white/15 p-2.5">
              {COMPOSER_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleDraftChange(`${draft}${emoji}`)}
                  className="text-lg hover:scale-125 transition-transform px-1.5 py-0.5 cursor-pointer"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* Composer Bar */}
          <form onSubmit={handleSendMessage} className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              type="button"
              aria-label="Attach file or image"
              disabled={phase !== "connected"}
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 rounded-full bg-white/5 border border-white/10 text-white/70 hover:text-white hover:border-white/25 disabled:opacity-40 cursor-pointer"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Insert emoji"
              disabled={phase !== "connected"}
              onClick={() => setShowEmojiPicker((prev) => !prev)}
              className="p-2.5 rounded-full bg-white/5 border border-white/10 text-white/70 hover:text-white hover:border-white/25 disabled:opacity-40 cursor-pointer"
            >
              <Smile className="w-4 h-4" />
            </button>
            <input
              type="text"
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              disabled={phase !== "connected"}
              placeholder={
                phase === "connected"
                  ? "Send encrypted whisper, file, or reply..."
                  : "Draft saved — re-pair WebRTC tunnel to send..."
              }
              className="flex-1 min-w-0 rounded-full bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-white/35 focus:outline-none focus:border-white/35 disabled:opacity-55"
            />
            <button
              type="submit"
              disabled={
                phase !== "connected" ||
                (!draft.trim().length && !pendingAttachment)
              }
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-white text-black text-xs font-semibold uppercase tracking-wider disabled:opacity-40 cursor-pointer shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
