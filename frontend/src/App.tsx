import { Routes, Route } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard';
import Home from './pages/Home';
import NotFound from './pages/NotFound';
import { api, googleLogin } from './api';
import './App.css';
function App() {
  const [signedIn,setSignedIn]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{api('/api/v1/session').then(r=>setSignedIn(r.ok)).catch(()=>setError('Start the API server to continue.')).finally(()=>setLoading(false));},[]);
  if(loading)return <p>Loading your calendar…</p>;
  if(!signedIn)return <main><h1>My Scheduler</h1><p>The original calendar and voice interface remains available during migration.</p><button onClick={async()=>{try{const r=await api('/api/v1/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone})});if(!r.ok)throw new Error((await r.json()).error);setSignedIn(true);}catch(e){setError(e instanceof Error?e.message:'Unable to start demo');}}}>Explore the demo</button><p><a href={googleLogin}>Connect Google Calendar</a></p>{error&&<p role="alert">{error}</p>}</main>;
  return <Routes><Route path="/" element={<Home/>}/><Route path="/dashboard" element={<Dashboard/>}/><Route path="*" element={<NotFound/>}/></Routes>;
}
export default App;
