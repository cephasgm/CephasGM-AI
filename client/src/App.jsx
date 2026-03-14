import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import Chat from './components/Chat';
// Import other components as you create them

function App() {
  return (
    <Router>
      <div style={{ background: 'rgba(0,0,0,0.7)', minHeight: '100vh', padding: '20px' }}>
        <h1 style={{ textAlign: 'center', color: '#ffb300' }}>CephasGM AI</h1>
        <nav style={{ display: 'flex', justifyContent: 'center', gap: '10px', margin: '20px 0', flexWrap: 'wrap' }}>
          <NavLink to="/chat" style={({ isActive }) => ({ padding: '12px 25px', borderRadius: '30px', background: isActive ? '#ffb300' : 'transparent', color: 'white', textDecoration: 'none' })}>💬 Chat</NavLink>
          <NavLink to="/image" style={({ isActive }) => ({ padding: '12px 25px', borderRadius: '30px', background: isActive ? '#ffb300' : 'transparent', color: 'white', textDecoration: 'none' })}>🎨 Image</NavLink>
          <NavLink to="/upload" style={({ isActive }) => ({ padding: '12px 25px', borderRadius: '30px', background: isActive ? '#ffb300' : 'transparent', color: 'white', textDecoration: 'none' })}>📁 Upload</NavLink>
          {/* Add more links as you create components */}
        </nav>
        <Routes>
          <Route path="/" element={<Chat />} />
          <Route path="/chat" element={<Chat />} />
          {/* Add other routes */}
        </Routes>
      </div>
    </Router>
  );
}

export default App;
