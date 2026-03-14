import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

function Chat() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const chatBoxRef = useRef();

  useEffect(() => {
    const saved = localStorage.getItem('chatHistory');
    if (saved) setMessages(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem('chatHistory', JSON.stringify(messages));
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const userMsg = { role: 'user', content: input, timestamp: new Date().toLocaleTimeString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await axios.post('/chat/stream', { prompt: input, model: 'gpt-3.5-turbo' }, {
        responseType: 'stream',
        adapter: 'fetch'
      });

      const reader = response.data.getReader();
      const decoder = new TextDecoder();
      let aiResponse = '';
      const aiMsg = { role: 'assistant', content: '', timestamp: new Date().toLocaleTimeString() };
      setMessages(prev => [...prev, aiMsg]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.choices && data.choices[0].delta.content) {
                aiResponse += data.choices[0].delta.content;
                setMessages(prev => {
                  const newMsg = [...prev];
                  newMsg[newMsg.length - 1].content = aiResponse;
                  return newMsg;
                });
              }
            } catch (e) {}
          }
        }
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message}`, timestamp: new Date().toLocaleTimeString() }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', color: 'white' }}>
      <h2>💬 Chat</h2>
      <div ref={chatBoxRef} style={{ height: '400px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '10px' }}>
        {messages.map((msg, idx) => (
          <div key={idx} style={{ marginBottom: '10px', textAlign: msg.role === 'user' ? 'right' : 'left' }}>
            <div style={{ background: msg.role === 'user' ? 'rgba(255,179,0,0.2)' : 'rgba(255,255,255,0.1)', padding: '8px', borderRadius: '10px', display: 'inline-block', maxWidth: '70%' }}>
              <div><small>{msg.timestamp}</small></div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
            </div>
          </div>
        ))}
        {loading && <div>Thinking...</div>}
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Ask CephasGM AI anything..."
          style={{ flex: 1, padding: '15px', borderRadius: '30px', border: 'none' }}
        />
        <button onClick={sendMessage} style={{ padding: '15px 30px', borderRadius: '30px', background: '#ffb300', border: 'none', cursor: 'pointer' }}>Send</button>
      </div>
    </div>
  );
}

export default Chat;
