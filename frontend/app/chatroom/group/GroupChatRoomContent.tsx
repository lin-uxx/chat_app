"use client";
import EmojiPicker from 'emoji-picker-react';
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";


export default function GroupChatRoomContent() {
  const wsRef = useRef<WebSocket | null>(null);
  const searchParams = useSearchParams();
  const roomId = searchParams.get("room_id");
  const router = useRouter();

  const [showMenu, setShowMenu] = useState(false);
  const [message, setMessage] = useState("");
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [roomTitle, setRoomTitle] = useState<string>("グループチャット");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messageReads, setMessageReads] = useState<Record<number, string[]>>({});
  const [messages, setMessages] = useState<{ id: number; content: string; sender: string; attachment?: string;}[]>([]);

  const [webSocketStatus, setWebSocketStatus] = useState<string>("undefined");
  const [systemMessage, setSystemMessage] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
 //hide
  const [actionTargetMsgId, setActionTargetMsgId] = useState<number | null>(null);
  const [actionBoxVisible, setActionBoxVisible] = useState<number | null>(null);
  const actionBoxRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());

  const [messageReactions, setMessageReactions] = useState<Record<number, { emoji: string; users: string[] }[]>>({});

  const [mentions, setMentions] = useState<string[]>([]); // ✅ 追加
  const [showMentionList, setShowMentionList] = useState(false); // ✅ 追加
  const [cursorPos, setCursorPos] = useState<number>(0); // ✅ 追加


  useEffect(() => {
    // ✅ /me API 経由で現在のユーザー名を取得
    fetch("http://localhost:8081/me", { credentials: "include" })
      .then((res) => {
        if (!res.ok) {
          router.push("/login");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data?.username) {
          setCurrentUser(data.username);
          setToken("valid"); // Dummy トークンで useEffect をトリガー
        }
        if (data?.user_id) {
          setCurrentUserId(data.user_id);
        }
      });
  }, [router]);

  useEffect(() => {
    if (!roomId || !token) return;
    fetch(`http://localhost:8081/rooms/${roomId}/join-group`, {
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data) => setMembers(data.members || []));

    fetch(`http://localhost:8081/rooms/${roomId}/info`, {
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.room_name) setRoomTitle(data.room_name);
      });

    fetch(`http://localhost:8081/messages?room_id=${roomId}`, {
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data) => {
        const msgs = (data.messages || [])
          .filter((m: any) => !m.content?.startsWith("reaction:")) // ✅ 過濾掉 reaction 訊息
          .map((m: any) => ({
            id: m.id,
            content: m.content,
            sender: m.sender,
            attachment: m.attachment || undefined,
          }));
        setMessages(msgs);
      });
  }, [roomId, token]);

  const fetchReads = async () => {
    const result: Record<number, string[]> = {};
    try {
      for (const msg of messages) {
        const res = await fetch(`http://localhost:8081/messages/${msg.id}/readers`, {
          credentials: "include",
        });
        const data = await res.json();
        result[msg.id] = data.readers || [];
      }
      setMessageReads(result);
    } catch (err) {
      console.error("讀取 messageReads 時發生錯誤", err);
    }
  };

  useEffect(() => {
    if (!roomId || !token) return;
    if (wsRef.current) wsRef.current.close();
    const ws = new WebSocket(`ws://localhost:8081/ws?room_id=${roomId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("✅ WebSocket 连接成功");
      setWebSocketStatus("connected");
      fetch(`http://localhost:8081/rooms/${roomId}/enter`, {
        method: "POST",
        credentials: "include",
      });
    };

    ws.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
       console.log("💬 收到訊息：", parsed);
      if (parsed.type === "read_update" && parsed.message_id) {
        setMessageReads((prev) => ({ ...prev, [parsed.message_id]: parsed.readers || [] }));
      }
      if (parsed.type === "message_revoked" && parsed.message_id) {
        setMessages(prev => prev.filter(m => m.id !== parsed.message_id));
      }
      if (parsed.type === "new_message" && parsed.message) {
        const msg = parsed.message;
        const content = msg.content || "";

        // ✅ 是 reaction 則處理並 return，不再加入 messages
        if (content.startsWith("reaction:")) {
          const [, emoji, targetIdStr] = content.split(":");
          const targetId = parseInt(targetIdStr);

          setMessageReactions((prev) => {
            const oldList = prev[targetId] || [];
            const existing = oldList.find((r) => r.emoji === emoji);
            let updated;

            if (existing) {
              const hasReacted = existing.users.includes(msg.sender);
              updated = hasReacted
                // ❌ 已存在 → 移除該用戶
                ? oldList
                    .map((r) =>
                      r.emoji === emoji
                        ? { ...r, users: r.users.filter((u) => u !== msg.sender) }
                        : r
                    )
                    .filter((r) => r.users.length > 0)
                // ✅ 不存在 → 加入該用戶
                : oldList.map((r) =>
                    r.emoji === emoji
                      ? {
                          ...r,
                          users: [...r.users, msg.sender].filter(
                            (v, i, a) => a.indexOf(v) === i
                          ), // 去重
                        }
                      : r
                  );
            } else {
              updated = [{ emoji, users: [msg.sender] }];
            }

            return { ...prev, [targetId]: updated };
          });



          return; // ✅ ✅ ✅ 確保這裡 return，避免 setMessages
        }

        // ✅ 普通訊息才進入聊天列表
        setMessages((prev) => [
          ...prev,
          {
            id: msg.id,
            sender: msg.sender,
            content: msg.content,
            attachment: msg.attachment || undefined,
          },
        ]);
      }


        // ✅ 新增：处理提及通知
      if (parsed.type === "mention_notify") {
        if (parsed.to_user && parsed.to_user === currentUserId) {
          alert(`🔔 ${parsed.from} さんにメンションされました: ${parsed.content}`);
        }
      }

      if (parsed.type === "user_entered" || parsed.type === "user_left") {
        const username = parsed.user;
        if (username !== currentUser) {
          const msg = parsed.type === "user_entered" ? `${username}さんが入室しました` : `${username}さんが退室しました`;
          setSystemMessage(msg);
          setTimeout(() => setSystemMessage(null), 2500);
        }
        fetch(`http://localhost:8081/rooms/${roomId}/join-group`, {
          credentials: "include",
        })
          .then((res) => res.json())
          .then((data) => setMembers(data.members || []));

        fetch(`http://localhost:8081/messages?room_id=${roomId}`, {
          credentials: "include",
        })
          .then((res) => res.json())
          .then((data) => {
            const rawMessages = data.messages || [];

            const normalMessages: { id: number; content: string; sender: string; attachment?: string }[] = [];
            const reactionMap: Record<number, Record<string, string[]>> = {};

            for (const m of rawMessages) {
              if (m.content?.startsWith("reaction:")) {
                const [, emoji, targetIdStr] = m.content.split(":");
                const targetId = parseInt(targetIdStr);
                if (!reactionMap[targetId]) {
                  reactionMap[targetId] = {};
                }
                if (!reactionMap[targetId][emoji]) {
                  reactionMap[targetId][emoji] = [];
                }
                if (!reactionMap[targetId][emoji].includes(m.sender)) {
                  reactionMap[targetId][emoji].push(m.sender);
                }
              } else {
                normalMessages.push({
                  id: m.id,
                  content: m.content,
                  sender: m.sender,
                  attachment: m.attachment || undefined,
                });
              }
            }

            // 更新訊息內容
            setMessages(normalMessages);

            // 將 reactionMap 轉換成符合 UI 結構的 messageReactions
            const structuredReactions: Record<number, { emoji: string; users: string[] }[]> = {};
            for (const [msgIdStr, emojiGroup] of Object.entries(reactionMap)) {
              const msgId = parseInt(msgIdStr);
              structuredReactions[msgId] = Object.entries(emojiGroup).map(([emoji, users]) => ({
                emoji,
                users,
              }));
            }

            // 更新 emoji 狀態
            setMessageReactions(structuredReactions);
          });

      }
    };

    ws.onerror = () => setWebSocketStatus("error");
    ws.onclose = () => setWebSocketStatus("closed");

    return () => ws.close();
  }, [roomId, token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!messages || !token || !currentUser) return;
    const lastMsg = messages[messages.length - 1];
    messages.forEach((msg) => {
      // const isSelfLastMsg = msg.id === lastMsg?.id && msg.sender === currentUser;
      // if (!isSelfLastMsg) {
      //   fetch(`http://localhost:8081/messages/${msg.id}/markread`, {
      //     method: "POST",
      //     credentials: "include",
      //   });
      // }
      fetch(`http://localhost:8081/messages/${msg.id}/markread`, {
        method: "POST",
        credentials: "include",
      });
    });
  }, [messages, currentUser, token]);

  const handleSend = async () => {
    const parsedRoomId = parseInt(roomId as string);
    if (!message.trim() || !token || isNaN(parsedRoomId)) return;
   ////////
    const mentionRegex = /@(\w+)/g;
    const foundMentions = [...message.matchAll(mentionRegex)].map(m => m[1]);4
    //////

    await fetch("http://localhost:8081/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
       body: JSON.stringify({
        room_id: parsedRoomId,
        content: message,
        thread_root_id: null,
        mentions: foundMentions,
      }),
    });
    setMessage("");
    setMentions([]);
  };
///////////////////////
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;

      // 遍历所有菜单浮出的 ref
      for (const [, ref] of actionBoxRefs.current) {
        if (ref && ref.contains(target)) {
          return; // 点在菜单内部，不关闭
        }
      }

      // 点在外部，关闭菜单
      setActionBoxVisible(null);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

/////////////////////////

  const handleLeaveGroup = async () => {
    if (!roomId || !token) return;
    const res = await fetch(`http://localhost:8081/rooms/${roomId}/leave`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      alert("退室しました");
      router.push("/chatroom");
    } else {
      alert("退室失敗しました");
    }
  };

  ///revoke
  const handleRevoke = async (msgId: number) => {
    const res = await fetch(`http://localhost:8081/messages/${msgId}/revoke`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      setMessages(prev => prev.filter(m => m.id !== msgId));
      actionBoxRefs.current.delete(msgId); // ← 清理对应引用
    } else {
      alert("撤回に失敗しました（2分以上経過した可能性があります）");
    }
  };
   //hide
  const handleHide = async (msgId: number) => {
    const res = await fetch(`http://localhost:8081/messages/${msgId}/hide`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      setMessages(prev => prev.filter(m => m.id !== msgId));
      actionBoxRefs.current.delete(msgId); // ← 清理对应引用
    } else {
      alert("削除に失敗しました");
    }
  };

    const handleReaction = async (targetMessageId: number, emoji: string) => {
    await fetch("http://localhost:8081/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        room_id: parseInt(roomId!),
        content: `reaction:${emoji}:${targetMessageId}`,
        thread_root_id: null,
        mentions: [],
      }),
    });
  };

  ////image
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !roomId ) return;

    const reader = new FileReader();
    reader.onload = () => setPreviewImage(reader.result as string);
    reader.readAsDataURL(file);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("room_id", roomId.toString());
    formData.append("type", "image");

    await fetch("http://localhost:8081/messages/upload", {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    setPreviewImage(null);
  };

  ////file
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !roomId) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("room_id", roomId.toString());
    formData.append("type", "file");

    await fetch("http://localhost:8081/messages/upload", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
  };


  return (
    <div className="h-screen flex flex-col overflow-hidden" onClick={() => setActionBoxVisible(null)}>
      <div className="relative bg-white p-4 border-b shadow-sm h-20 flex items-center justify-center" style={{ backgroundColor: "#f5fffa" }}>
        {/* ← 戻るボタン（チャットルーム一覧へ） */}
        <button
          onClick={() => router.push("/chatroom")}
          className="absolute left-4 top-1/2 transform -translate-y-1/2 text-[#2e8b57] hover:text-green-800 transition"
          aria-label="Back to Room List"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-7 w-7"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <h2 className="text-lg text-[#2e8b57] font-semibold">{roomTitle} (ID: {roomId})</h2>

        <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
          <img
            src="/window.svg"
            alt="My Avatar"
            className="w-8 h-8 rounded-full cursor-pointer"
            onClick={() => setShowMenu((prev) => !prev)}
          />
          {showMenu && (
            <div className="absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded shadow-lg z-10">
              <button onClick={() => router.push("/")} className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm">ホームページ</button>
              <button onClick={handleLeaveGroup} className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm text-red-500">退室します</button>
              <button
                onClick={async () => {
                  await fetch("http://localhost:8081/logout", {
                    method: "POST",
                    credentials: "include",
                  });
                  router.push("/login");
                }}
                className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm text-red-500"
              >
                ログアウト
              </button>
            </div>
          )}
        </div>
      </div>


      <div className="flex flex-1 overflow-hidden">
        {/* 左側成員列表 */}
        <div className="w-1/5 bg-[#2e8b57] text-white p-4 overflow-y-auto">
          <h3 className="text-md font-semibold mb-4 text-center">メンバー</h3>
          <ul className="space-y-3">
            {members.map((name, idx) => (
              <li key={idx} className="bg-white text-[#2e8b57] rounded px-3 py-2 text-sm text-center">
                {name}
              </li>
            ))}
          </ul>
        </div>

        {/* 訊息區塊 */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
            {messages.map((msg) => {
              const readers = messageReads[msg.id] || [];
              const isSender = msg.sender === currentUser;
              return (
                <div
                  key={msg.id}
                  className={`flex items-end ${isSender ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`flex items-end ${isSender ? "flex-row" : "flex-row-reverse"} group relative`}
                  >
                    {/* 三点按钮 */}
                    <div className="relative z-10">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActionBoxVisible((prev) => (prev === msg.id ? null : msg.id));
                        }}
                        className="w-6 h-6 flex items-center justify-center rounded-full text-[#2e8b57] hover:bg-[#2e8b57]/20 text-sm transition opacity-0 group-hover:opacity-100"
                      >
                        ⋯
                      </button>

                      {/* 对方：左上浮出 */}
                      {!isSender && actionBoxVisible === msg.id && (
                        <div
                          ref={(el) => {
                            actionBoxRefs.current.set(msg.id, el);
                          }}
                          className="absolute bottom-full mb-2 left-0 bg-white border rounded shadow px-3 py-1 text-sm text-gray-800 whitespace-nowrap z-50 action-box"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => handleHide(msg.id)}
                            className="hover:underline"
                          >
                            削除
                          </button>
                          <div className="mt-2 flex space-x-1">
                            <button onClick={() => handleReaction(msg.id, "😄")}>😄</button>
                            <button onClick={() => handleReaction(msg.id, "👍")}>👍</button>
                            <button onClick={() => handleReaction(msg.id, "❤️")}>❤️</button>
                          </div>
                        </div>
                      )}

                      {/* 自己：右上浮出 */}
                      {isSender && actionBoxVisible === msg.id && (
                        <div
                          ref={(el) => {
                            actionBoxRefs.current.set(msg.id, el);
                          }}
                          className="absolute bottom-full mb-2 right-0 bg-white border rounded shadow px-3 py-1 text-sm text-gray-800 whitespace-nowrap z-50 action-box"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => handleHide(msg.id)}
                            className="hover:underline mr-2"
                          >
                            削除
                          </button>
                          <button
                            onClick={() => handleRevoke(msg.id)}
                            className="hover:underline"
                          >
                            送信取消
                          </button>
                           <div className="mt-2 flex space-x-1">
                            <button onClick={() => handleReaction(msg.id, "😄")}>😄</button>
                            <button onClick={() => handleReaction(msg.id, "👍")}>👍</button>
                            <button onClick={() => handleReaction(msg.id, "❤️")}>❤️</button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 消息气泡 */}
                    <div
                      className={`ml-2 mr-2 p-2 rounded-lg max-w-xs ${
                        isSender ? "bg-blue-500" : "bg-green-700"
                      } text-white`}
                    >
                      <div className="text-xs font-semibold mb-1">{msg.sender}</div>
                      {msg.content && <div>{msg.content}</div>}

                      {/* Reaction 表示區塊 */}
                      <div className="mt-1 flex space-x-2">
                        {(messageReactions[msg.id] || []).map(r => (
                          <div
                            key={r.emoji}
                            className="text-sm bg-white text-gray-700 rounded-full px-2 py-1 border"
                            title={r.users.join(", ")} // tooltip 顯示使用者
                          >
                            {r.emoji} {r.users.length}
                          </div>
                        ))}
                      </div>

                      {msg.attachment && msg.attachment.match(/\.(jpg|jpeg|png|gif)$/i) ? (
                        <img
                          src={`http://localhost:8081${
                            msg.attachment.startsWith("/uploads/")
                              ? msg.attachment
                              : `/uploads/${msg.attachment}`
                          }`}
                          alt="attachment"
                          className="mt-2 rounded shadow max-w-full h-auto"
                        />
                      ) : msg.attachment ? (
                        <a
                          href={`http://localhost:8081${
                            msg.attachment.startsWith("/uploads/")
                              ? msg.attachment
                              : `/uploads/${msg.attachment}`
                          }`}
                          target="_blank"
                          className="text-blue-200 underline text-sm block mt-2"
                        >
                          📎 添付ファイルを開く
                        </a>
                      ) : null}

                      <div className="text-[10px] mt-1 text-right">
                        {readers.length === 0
                          ? "未読"
                          : `既読 ${readers.length}人: ${readers.join(", ")}`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* ===== 精簡後聊天輸入區（功能列靠左，自動增高）===== */}
          <div className="border-t bg-white px-4 py-3">
            {/* 預覽圖片（可選） */}
            {previewImage && (
              <div className="mb-2 relative w-fit">
                <img src={previewImage} className="max-h-48 rounded shadow" alt="preview" />
                <button
                  onClick={() => setPreviewImage(null)}
                  className="absolute -top-2 -right-2 bg-black text-white text-xs rounded-full w-5 h-5 flex items-center justify-center"
                >
                  ×
                </button>
              </div>
            )}

            <div className="flex items-end">
              {/* 功能按鈕列（左下） */}
              <div className="flex flex-col justify-end mr-2">
                <input type="file" id="file-upload" style={{ display: "none" }} onChange={handleFileUpload} />
                <input type="file" accept="image/*" id="image-upload" style={{ display: "none" }} onChange={handleImageUpload} />

                <div className="relative flex space-x-2 text-xl text-gray-600">
                  <button onClick={() => document.getElementById("file-upload")?.click()} title="ファイル">📎</button>
                  <button onClick={() => document.getElementById("image-upload")?.click()} title="画像">🖼️</button>
                  <button onClick={() => setShowEmojiPicker(prev => !prev)} title="絵文字">😊</button>
                  {showEmojiPicker && (
                    <div
                      className="absolute z-50 bg-white rounded shadow-lg origin-bottom-left"
                      style={{
                        bottom: '100%',
                        left: 0,
                        transform: 'translateY(-10px) scale(0.75)', // 等比缩小整个 UI
                        transformOrigin: 'bottom left',
                      }}
                    >
                      <EmojiPicker
                        onEmojiClick={(emojiData) => {
                          setMessage((prev) => prev + emojiData.emoji); // 插入的是 emoji 字符，不受视觉缩放影响
                          setShowEmojiPicker(false);
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* 輸入欄與送信按鈕 */}
              <div className="flex-1 flex flex-col relative">
                <textarea
                  className="w-full border rounded px-3 py-2 text-sm resize-none max-h-36 overflow-y-auto"
                  rows={1}
                  placeholder="メッセージを入力...（Enterで送信 / Shift+Enterで改行）"
                  value={message}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMessage(val);
                    const lastChar = val.slice(e.target.selectionStart - 1, e.target.selectionStart);
                    setCursorPos(e.target.selectionStart);
                    if (lastChar === "@") {
                      setShowMentionList(true);
                    } else {
                      setShowMentionList(false);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  // onChange={(e) => setMessage(e.target.value)}
                  // onKeyDown={(e) => {
                  //   if (e.key === "Enter" && !e.shiftKey) {
                  //     e.preventDefault();
                  //     handleSend();
                  //   }
                  // }}
                />
                {/* ✅ mention popup */}
                {showMentionList && (
                  <div
                    className="absolute z-50 bg-white border rounded shadow max-h-40 overflow-y-auto text-sm"
                    style={{
                      bottom: "3rem",
                      left: "0.5rem",
                    }}
                  >
                    {members
                      .filter(name => name !== currentUser)
                      .map((name) => (
                        <div
                          key={name}
                          className="px-3 py-1 hover:bg-gray-200 cursor-pointer"
                          onClick={() => {
                            const before = message.slice(0, cursorPos);
                            const after = message.slice(cursorPos);
                            const newText = before + name + " " + after;
                            setMessage(newText);
                            setShowMentionList(false);
                          }}
                        >
                          @{name}
                        </div>
                      ))}
                  </div>
                )}

              </div>     

              {/* 送信按鈕 */}
              <div className="ml-3">
                <button
                  onClick={handleSend}
                  className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                >
                  送信
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}