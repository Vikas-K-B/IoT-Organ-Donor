
import React, { useState, useEffect, useRef } from 'react';
import { User, UserMode, Task, TaskStatus, NetworkMessage, MessageType } from '../types';
import { executePythonSimulation } from '../services/geminiService';
import { Activity, Server, UploadCloud, DownloadCloud, Coins, LogOut, Cpu, Users, Wifi, Play, Terminal, X, CheckCircle, Database, Globe } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';

interface DashboardProps {
  user: User;
  onLogout: () => void;
  onUpdatePoints: (points: number) => void;
}

// MQTT Configuration
// Switched to HiveMQ as it is often more stable for WSS in various regions
const MQTT_BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const HEARTBEAT_INTERVAL = 3000;
const PEER_TIMEOUT = 10000; // Increased timeout for peer cleanup

const Dashboard: React.FC<DashboardProps> = ({ user, onLogout, onUpdatePoints }) => {
  const [currentUser, setCurrentUser] = useState<User>(user);
  const [activeMode, setActiveMode] = useState<UserMode>(user.mode);
  
  // Dynamic Topics based on Network ID
  const TOPIC_BASE = `gridsync/${user.networkId}`;
  const TOPIC_BROADCAST = `${TOPIC_BASE}/broadcast`;
  
  // Network State
  const [peers, setPeers] = useState<Map<string, User>>(new Map());
  const [activeTasks, setActiveTasks] = useState<Task[]>([]);
  const [notifications, setNotifications] = useState<{id: string, message: string, type: 'success' | 'info' | 'blockchain'}[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  
  // Task Creation State
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [pythonCode, setPythonCode] = useState("print('Hello GridSync')");
  
  // Refs to handle stale closures in Event Listeners / Intervals
  const clientRef = useRef<any>(null); // MQTT Client
  const processedTasksRef = useRef<Set<string>>(new Set());
  const stateRef = useRef({ currentUser, activeMode });
  
  // Resource Simulation Ref (Keeps the unique baseline for this specific node)
  const resourceBaseRef = useRef({
      cpu: user.cpuUsage || 10,
      mem: user.memoryUsage || 20
  });

  // Update ref whenever state changes so intervals access latest data
  useEffect(() => {
    stateRef.current = { currentUser, activeMode };
  }, [currentUser, activeMode]);

  // Chart Data
  const [performanceData, setPerformanceData] = useState<{time: string, load: number}[]>([]);

  // --------------------------------------------------------------------------------
  // INITIALIZATION & MQTT SETUP
  // --------------------------------------------------------------------------------

  useEffect(() => {
    // Access MQTT from window (injected via script tag in index.html)
    const mqtt = (window as any).mqtt;
    if (!mqtt) {
        addNotification("MQTT Library not found. Check internet connection.", 'info');
        return;
    }

    const clientId = `gridsync_${Math.random().toString(16).slice(2, 8)}`;
    
    addNotification(`Connecting to Grid Network: ${user.networkId}...`, 'info');

    // Robust connection options
    const client = mqtt.connect(MQTT_BROKER, {
        keepalive: 60,
        clientId: clientId,
        clean: true,
        connectTimeout: 15000, // 15s timeout to prevent connack errors
        reconnectPeriod: 2000, // Retry every 2s if disconnected
    });

    clientRef.current = client;

    client.on('connect', () => {
        setIsConnected(true);
        addNotification(`Joined Network: ${user.networkId}`, 'success');
        
        // Subscribe to Global Broadcasts (Discovery) for this network
        client.subscribe(TOPIC_BROADCAST, (err: any) => {
            if (err) console.error("Sub error:", err);
        });
        
        // Subscribe to My Private Channel (Task Requests)
        client.subscribe(`${TOPIC_BASE}/node/${user.id}`);

        // Announce Presence
        broadcast(client, 'HELLO', null);
    });

    client.on('reconnect', () => {
        addNotification("Reconnecting to Grid...", 'info');
    });

    client.on('message', (topic: string, message: any) => {
        try {
            const msg: NetworkMessage = JSON.parse(message.toString());
            handleNetworkMessage(msg, topic);
        } catch (e) {
            console.error("Failed to parse MQTT message", e);
        }
    });

    client.on('error', (err: any) => {
        console.error('Connection error: ', err);
        // Don't set isConnected false immediately on error, wait for close/offline
        if (err.message && err.message.includes('connack')) {
            addNotification("Connection Timeout. Retrying...", 'info');
        }
    });

    client.on('offline', () => {
        setIsConnected(false);
    });

    // Start Heartbeat Loop
    const hbInterval = setInterval(() => {
      if (client.connected) {
          broadcast(client, 'HEARTBEAT', null);
          pruneStalePeers();
      }
    }, HEARTBEAT_INTERVAL);

    // Handle Window Close/Refresh to remove from grid
    const handleBeforeUnload = () => {
        if (client.connected) {
             const { currentUser: latestUser } = stateRef.current;
             const msg: NetworkMessage = {
                type: 'LEAVE',
                sender: latestUser,
                timestamp: Date.now()
             };
             client.publish(TOPIC_BROADCAST, JSON.stringify(msg));
        }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(hbInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (client.connected) {
          handleBeforeUnload(); // Try to send leave on component unmount too
          client.end();
      }
    };
  }, []);

  // Sync currentUser state changes (like mode/points) to network immediately
  useEffect(() => {
    // This handles points updates, but mode updates are handled explicitly in toggle to be faster
    if (clientRef.current && isConnected) {
        broadcast(clientRef.current, 'HEARTBEAT', null);
    }
  }, [currentUser.points]);

  const broadcast = (client: any, type: MessageType, payload: any, targetId?: string) => {
    // CRITICAL: Always read from Ref to avoid sending stale "IDLE" mode after switching
    const { currentUser: latestUser, activeMode: latestMode } = stateRef.current;

    const msg: NetworkMessage = {
      type,
      sender: { ...latestUser, mode: latestMode, lastSeen: Date.now() },
      targetId,
      payload,
      timestamp: Date.now()
    };

    const payloadStr = JSON.stringify(msg);

    if (targetId) {
        // Direct Message
        client.publish(`${TOPIC_BASE}/node/${targetId}`, payloadStr);
    } else {
        // Global Broadcast
        client.publish(TOPIC_BROADCAST, payloadStr);
    }
  };

  const handleNetworkMessage = (msg: NetworkMessage, topic: string) => {
      const { currentUser: latestUser } = stateRef.current;

      // Ignore own messages
      if (msg.sender.id === latestUser.id) return;

      // Handle LEAVE message explicitly
      if (msg.type === 'LEAVE') {
          setPeers(prev => {
              const newMap = new Map(prev);
              newMap.delete(msg.sender.id);
              return newMap;
          });
          return;
      }

      switch (msg.type) {
        case 'HELLO':
        case 'HEARTBEAT':
          handlePeerDiscovery(msg.sender);
          break;
        case 'TASK_OFFER':
          // Only accept tasks if we are in IDLE mode
          if (stateRef.current.activeMode === UserMode.IDLE) {
            handleIncomingTask(msg.payload, msg.sender);
          }
          break;
        case 'TASK_PROGRESS':
          updateRemoteTaskProgress(msg.payload);
          break;
        case 'TASK_COMPLETE':
          completeRemoteTask(msg.payload);
          break;
      }
  };

  const handlePeerDiscovery = (peer: User) => {
    setPeers(prev => {
      const newMap = new Map(prev);
      // Always overwrite with latest data. If they switched from IDLE to PROVIDER, this update reflects that.
      newMap.set(peer.id, { ...peer, lastSeen: Date.now() });
      return newMap;
    });
  };

  const pruneStalePeers = () => {
    const now = Date.now();
    setPeers(prev => {
      const newMap = new Map(prev);
      let changed = false;
      newMap.forEach((p, id) => {
        if (p.lastSeen && now - p.lastSeen > PEER_TIMEOUT) {
          newMap.delete(id);
          changed = true;
        }
      });
      return changed ? newMap : prev;
    });
  };

  // --------------------------------------------------------------------------------
  // TASK LOGIC - PROVIDER
  // --------------------------------------------------------------------------------

  const initiateTaskAssignment = (workerId: string) => {
      setSelectedWorkerId(workerId);
      setIsTaskModalOpen(true);
      setPythonCode("# Write your python task here\ndef compute():\n    return sum(range(100))\n\nprint(compute())");
  };

  const submitTask = () => {
    if (!clientRef.current || !selectedWorkerId) return;

    const { currentUser: latestUser } = stateRef.current;
    const worker = peers.get(selectedWorkerId);
    if (!worker) return;

    const mqttTopic = `${TOPIC_BASE}/node/${selectedWorkerId}`;

    const newTask: Task = {
        id: `task-${latestUser.id}-${Date.now()}`,
        title: "Remote Python Execution",
        description: "Executing Custom Script",
        codeSnippet: pythonCode,
        requesterId: latestUser.id,
        requesterName: latestUser.username,
        workerId: worker.id,
        workerName: worker.username,
        status: TaskStatus.PENDING,
        progress: 0,
        reward: 10,
        topic: mqttTopic
    };

    setActiveTasks(prev => [newTask, ...prev]);

    // Send over MQTT
    broadcast(clientRef.current, 'TASK_OFFER', newTask, selectedWorkerId);
    
    addNotification(`MQTT PUB: ${mqttTopic}`, 'info');
    setIsTaskModalOpen(false);
  };

  const updateRemoteTaskProgress = (taskUpdate: Task) => {
    setActiveTasks(current => 
        current.map(t => t.id === taskUpdate.id ? { ...t, progress: taskUpdate.progress, status: TaskStatus.PROCESSING } : t)
    );
  };

  const completeRemoteTask = (completedTask: Task) => {
      setActiveTasks(current => 
        current.map(t => t.id === completedTask.id ? { ...t, status: TaskStatus.COMPLETED, resultData: completedTask.resultData, progress: 100, txHash: completedTask.txHash } : t)
      );
      addNotification(`Block Confirmed: ${completedTask.txHash?.substring(0, 10)}...`, 'blockchain');
  };

  // --------------------------------------------------------------------------------
  // TASK LOGIC - WORKER
  // --------------------------------------------------------------------------------

  const handleIncomingTask = (task: Task, sender: User) => {
     if (processedTasksRef.current.has(task.id)) return;
     processedTasksRef.current.add(task.id);

     const { currentUser: latestUser } = stateRef.current;

     const myTask = { ...task, workerId: latestUser.id, workerName: latestUser.username };
     setActiveTasks(prev => [myTask, ...prev]);
     addNotification(`MQTT SUB: ${task.topic}`, 'info');

     // Automatically start processing
     processTask(myTask, sender.id);
  };

  const processTask = (task: Task, requesterId: string) => {
      let progress = 0;
      
      const interval = setInterval(async () => {
          progress += Math.floor(Math.random() * 10) + 5;
          
          if (progress > 100) progress = 100;

          setActiveTasks(current => 
              current.map(t => t.id === task.id ? { ...t, progress, status: TaskStatus.PROCESSING } : t)
          );

          // Broadcast progress
          if (clientRef.current && progress < 100) {
              const updatedTask = { ...task, progress, status: TaskStatus.PROCESSING };
              broadcast(clientRef.current, 'TASK_PROGRESS', updatedTask, requesterId);
          }

          if (progress >= 100) {
              clearInterval(interval);
              
              const result = await executePythonSimulation(task.codeSnippet || "print('No code provided')");
              
              const txHash = "0x" + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');

              const completedTask = { 
                  ...task, 
                  progress: 100, 
                  status: TaskStatus.COMPLETED, 
                  resultData: result,
                  txHash: txHash
              };

              setActiveTasks(current => 
                  current.map(t => t.id === task.id ? completedTask : t)
              );

              onUpdatePoints(10);
              setCurrentUser(prev => ({ ...prev, points: prev.points + 10 })); 
              addNotification(`Gas Paid. Tx: ${txHash.substring(0, 8)}...`, 'blockchain');

              if (clientRef.current) {
                  broadcast(clientRef.current, 'TASK_COMPLETE', completedTask, requesterId);
              }
          }
      }, 300);
  };

  // --------------------------------------------------------------------------------
  // UI & HELPERS
  // --------------------------------------------------------------------------------

  const handleModeToggle = (mode: UserMode) => {
    // 1. Update React State
    setActiveMode(mode);
    setCurrentUser(prev => ({ ...prev, mode }));
    setActiveTasks([]); 
    addNotification(`Switched to ${mode} mode`, 'info');

    // 2. Force Update REF immediately to ensure the next heartbeat/broadcast uses correct mode
    const updatedUser = { ...currentUser, mode };
    stateRef.current = { currentUser: updatedUser, activeMode: mode };

    // 3. FORCE BROADCAST immediately with the NEW mode
    if (clientRef.current) {
         const msg: NetworkMessage = {
          type: 'HEARTBEAT',
          sender: { ...updatedUser, mode: mode, lastSeen: Date.now() },
          targetId: undefined,
          payload: null,
          timestamp: Date.now()
        };
        clientRef.current.publish(TOPIC_BROADCAST, JSON.stringify(msg));
    }
  };

  const addNotification = (message: string, type: 'success' | 'info' | 'blockchain') => {
      setNotifications(prev => [...prev.slice(-4), { id: Date.now().toString() + Math.random(), message, type }]);
  };

  useEffect(() => {
    const interval = setInterval(() => {
        // Calculate new load with fluctuation AROUND THE BASELINE
        // This ensures every node maintains its unique characteristic (e.g. Node A ~15%, Node B ~60%)
        // instead of generic random noise.
        const base = resourceBaseRef.current.cpu;
        const noise = (Math.random() * 10) - 5; // Fluctuate +/- 5%
        
        let activeLoad = base + noise;

        // If in provider mode, simulate high load
        if (activeMode === UserMode.PROVIDER) {
             activeLoad = Math.max(75, activeLoad + 50);
        }

        // Clamp values
        activeLoad = Math.min(99, Math.max(1, activeLoad));

        setPerformanceData(prev => {
            const now = new Date();
            const timeStr = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
            const newPoint = {
                time: timeStr,
                load: activeLoad
            };
            const newData = [...prev, newPoint];
            if (newData.length > 20) newData.shift();
            return newData;
        });

        // Update current user state so heartbeats carry this new data
        setCurrentUser(prev => ({
            ...prev,
            cpuUsage: activeLoad,
            memoryUsage: Math.min(100, Math.max(10, resourceBaseRef.current.mem + noise))
        }));

    }, 2000); // 2 second update cycle
    return () => clearInterval(interval);
  }, [activeMode]);

  const peersList = Array.from(peers.values());
  const idlePeers = peersList.filter(p => p.mode === UserMode.IDLE);

  return (
    <div className="min-h-screen pb-10 text-slate-200">
      
      {/* Header */}
      <header className="bg-slate-900/90 backdrop-blur-md border-b border-cyan-500/20 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <div className="bg-cyan-500/10 p-2 rounded-lg border border-cyan-500/30">
                     <Activity className="text-cyan-400 w-6 h-6 animate-pulse" />
                </div>
                <div className="flex flex-col">
                    <span className="font-bold font-mono tracking-tight text-white">Grid<span className="text-cyan-400">Sync</span></span>
                    <span className="text-xs text-slate-400 font-mono uppercase flex items-center gap-1">
                        <Globe className={`w-3 h-3 ${isConnected ? 'text-emerald-500' : 'text-red-500'}`} /> 
                        NET: {user.networkId}
                    </span>
                </div>
            </div>

            <div className="flex items-center gap-6">
                <div className="hidden md:flex items-center gap-2 text-xs font-mono text-slate-500 bg-slate-800/50 px-3 py-1 rounded border border-slate-700">
                    <Users className="w-3 h-3" />
                    <span className="font-bold text-cyan-500">
                        {activeMode === UserMode.PROVIDER 
                            ? `AVAILABLE WORKERS: ${idlePeers.length}` 
                            : `NETWORK NODES: ${peersList.length + 1}`
                        }
                    </span>
                </div>

                <div className="flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-full border border-yellow-500/20">
                    <Coins className="w-4 h-4 text-yellow-400" />
                    <span className="font-mono font-bold text-yellow-100">{currentUser.points} CR</span>
                </div>
                
                <div className="flex items-center gap-3 pl-6 border-l border-slate-700">
                    <div className="text-right hidden sm:block">
                        <div className="text-sm font-bold text-white">{currentUser.username}</div>
                        <div className={`text-xs flex items-center justify-end gap-1 ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`}></span>
                            {isConnected ? 'ONLINE' : 'OFFLINE'}
                        </div>
                    </div>
                    <button onClick={onLogout} className="p-2 hover:bg-red-500/10 rounded-lg group transition-colors">
                        <LogOut className="w-5 h-5 text-slate-400 group-hover:text-red-400" />
                    </button>
                </div>
            </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Stats & Mode */}
          <div className="space-y-6">
              
              {/* Mode Toggle Card */}
              <div className="bg-slate-900/60 backdrop-blur-sm border border-slate-700 rounded-xl p-6 shadow-xl">
                  <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                      <Server className="w-5 h-5 text-cyan-400" /> System Mode
                  </h2>
                  <div className="grid grid-cols-2 gap-4">
                      <button 
                        onClick={() => handleModeToggle(UserMode.PROVIDER)}
                        className={`p-4 rounded-xl border flex flex-col items-center gap-3 transition-all ${
                            activeMode === UserMode.PROVIDER 
                            ? 'bg-red-500/10 border-red-500 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.3)]' 
                            : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                        }`}
                      >
                          <UploadCloud className="w-8 h-8" />
                          <div className="text-center">
                              <div className="font-bold">Running Task</div>
                              <div className="text-xs opacity-70">Offload CPU</div>
                          </div>
                      </button>

                      <button 
                        onClick={() => handleModeToggle(UserMode.IDLE)}
                        className={`p-4 rounded-xl border flex flex-col items-center gap-3 transition-all ${
                            activeMode === UserMode.IDLE 
                            ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]' 
                            : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600'
                        }`}
                      >
                          <DownloadCloud className="w-8 h-8" />
                          <div className="text-center">
                              <div className="font-bold">Idle</div>
                              <div className="text-xs opacity-70">Earn Points</div>
                          </div>
                      </button>
                  </div>
              </div>

              {/* System Stats Chart */}
              <div className="bg-slate-900/60 backdrop-blur-sm border border-slate-700 rounded-xl p-6 shadow-xl relative overflow-hidden">
                    <h3 className="text-sm font-bold text-slate-400 mb-4 flex items-center gap-2 font-mono">
                        <Cpu className="w-4 h-4" /> LOCAL_RESOURCE_LOAD
                    </h3>
                    <div className="h-40 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={performanceData}>
                                <defs>
                                    <linearGradient id="colorLoad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={activeMode === UserMode.PROVIDER ? "#ef4444" : "#22d3ee"} stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor={activeMode === UserMode.PROVIDER ? "#ef4444" : "#22d3ee"} stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="time" hide />
                                <YAxis hide domain={[0, 100]} />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                                    itemStyle={{ color: '#22d3ee' }}
                                />
                                <Area 
                                    type="monotone" 
                                    dataKey="load" 
                                    stroke={activeMode === UserMode.PROVIDER ? "#ef4444" : "#22d3ee"} 
                                    fillOpacity={1} 
                                    fill="url(#colorLoad)" 
                                    isAnimationActive={false}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex justify-between mt-2 font-mono text-xs text-slate-500">
                        <span>CPU: {performanceData[performanceData.length - 1]?.load.toFixed(1)}%</span>
                        <span>MEM: {currentUser.memoryUsage.toFixed(0)}%</span>
                    </div>
              </div>

              {/* Notifications List */}
              <div className="space-y-2">
                 {notifications.slice(-4).reverse().map(n => (
                     <div key={n.id} className={`text-xs p-3 rounded-lg border border-l-4 font-mono break-all ${
                         n.type === 'success' ? 'bg-emerald-900/20 border-emerald-500/30 border-l-emerald-500' : 
                         n.type === 'blockchain' ? 'bg-purple-900/20 border-purple-500/30 border-l-purple-500' :
                         'bg-blue-900/20 border-blue-500/30 border-l-blue-500'
                     }`}>
                         {n.message}
                     </div>
                 ))}
              </div>
          </div>

          {/* Main Column: Task Management */}
          <div className="lg:col-span-2 space-y-6">
              
              {/* Active Tasks Panel */}
              <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700 rounded-xl p-6 shadow-xl min-h-[400px]">
                  <div className="flex items-center justify-between mb-6">
                      <h2 className="text-xl font-bold text-white font-mono flex items-center gap-2">
                          {activeMode === UserMode.PROVIDER ? (
                              <><UploadCloud className="w-5 h-5 text-red-400"/> NETWORK_NODES // IDLE</>
                          ) : (
                              <><DownloadCloud className="w-5 h-5 text-emerald-400"/> INCOMING_STREAMS</>
                          )}
                      </h2>
                      <span className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-400 font-mono">
                          {activeMode === UserMode.PROVIDER ? `${idlePeers.length} IDLE NODES DETECTED` : 'LISTENING FOR TASKS...'}
                      </span>
                  </div>

                  {activeMode === UserMode.PROVIDER ? (
                      // PROVIDER VIEW: List of idle nodes
                      <>
                        {idlePeers.length === 0 ? (
                            <div className="text-center text-slate-500 py-12 border-2 border-dashed border-slate-800 rounded-lg">
                                <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                <p className="font-mono">No Idle Nodes Detected</p>
                                <p className="text-xs mt-2">Open the site on another device and set to 'Idle'.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {idlePeers.map(peer => {
                                    // Calculate availability display based on peer stats
                                    const availableRes = 100 - (peer.cpuUsage || 0);
                                    let statusColor = 'text-emerald-400';
                                    let barColor = 'bg-emerald-500';
                                    let label = 'High';

                                    if (availableRes < 30) { 
                                        label = 'Low'; 
                                        statusColor = 'text-red-400'; 
                                        barColor = 'bg-red-500'; 
                                    } else if (availableRes < 70) { 
                                        label = 'Med'; 
                                        statusColor = 'text-yellow-400'; 
                                        barColor = 'bg-yellow-500'; 
                                    }

                                    return (
                                    <div key={peer.id} className="bg-slate-800/40 border border-slate-700 hover:border-cyan-500/50 p-4 rounded-lg transition-all group relative overflow-hidden">
                                        <div className="flex justify-between items-start mb-3 relative z-10">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center font-mono text-xs font-bold text-cyan-400 border border-cyan-500/30">
                                                    {peer.username.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-sm text-white group-hover:text-cyan-400 transition-colors">{peer.username}</div>
                                                    <div className="text-xs text-emerald-500 flex items-center gap-1">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_#10b981]"></span> IDLE
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-xs font-mono text-slate-500">{peer.points} CR</div>
                                        </div>
                                        
                                        <div className="space-y-2 mb-4 relative z-10">
                                            <div className="flex justify-between text-xs text-slate-400">
                                                <span>Avail. Resources</span>
                                                <span className={`font-bold ${statusColor}`}>{label} ({availableRes.toFixed(0)}%)</span>
                                            </div>
                                            <div className="w-full bg-slate-700 h-1 rounded-full overflow-hidden">
                                                <div className={`${barColor} h-full transition-all duration-500`} style={{ width: `${availableRes}%` }}></div>
                                            </div>
                                        </div>

                                        <button 
                                            onClick={() => initiateTaskAssignment(peer.id)}
                                            className="w-full py-2 bg-slate-700 hover:bg-cyan-600 hover:text-white text-slate-300 rounded text-xs font-bold font-mono transition-colors flex items-center justify-center gap-2 relative z-10"
                                        >
                                            <Terminal className="w-3 h-3" /> DEPLOY PYTHON TASK
                                        </button>

                                        {/* Decorative BG */}
                                        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                    </div>
                                )})}
                            </div>
                        )}
                      </>
                  ) : (
                      // WORKER VIEW: Waiting for tasks
                      <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-800 rounded-lg bg-slate-800/20">
                          {activeTasks.length === 0 ? (
                              <div className="text-center text-slate-500">
                                  <div className="relative inline-block">
                                    <div className="absolute inset-0 bg-emerald-500/20 rounded-full animate-ping"></div>
                                    <Server className="w-12 h-12 mb-2 relative z-10 text-emerald-500/50" />
                                  </div>
                                  <p className="font-mono text-sm text-emerald-400">Node Ready & Listening</p>
                                  <p className="text-xs mt-2 text-slate-600">Waiting for MQTT deployment...</p>
                              </div>
                          ) : (
                              <div className="w-full h-full p-4 overflow-y-auto space-y-3">
                                  <div className="text-center text-emerald-400 font-mono text-sm mb-4 animate-pulse">
                                      EXECUTING REMOTE SCRIPT...
                                  </div>
                              </div>
                          )}
                      </div>
                  )}
              </div>

              {/* Task History / Live Status */}
              <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700 rounded-xl p-6 shadow-xl">
                  <h3 className="text-sm font-bold text-slate-400 mb-4 font-mono uppercase border-b border-slate-800 pb-2 flex justify-between">
                      <span>Live Operations Log</span>
                      <span className="flex items-center gap-1 text-[10px] text-purple-400">
                          <Database className="w-3 h-3" /> GANACHE TESTNET
                      </span>
                  </h3>
                  <div className="space-y-3">
                      {activeTasks.length === 0 && (
                          <div className="text-xs text-slate-600 font-mono italic text-center py-4">No active operations.</div>
                      )}
                      {activeTasks.map(task => (
                          <div key={task.id} className="bg-slate-800/30 border border-slate-700 rounded-lg p-3 flex flex-col gap-2">
                              <div className="flex justify-between items-start">
                                  <div className="flex flex-col">
                                      <span className="text-sm font-bold text-white font-mono flex items-center gap-2">
                                          <Play className="w-3 h-3 text-cyan-400" /> {task.title}
                                      </span>
                                      <span className="text-[10px] text-slate-500 font-mono mt-1">
                                          {task.status === TaskStatus.COMPLETED && task.txHash ? `TX: ${task.txHash}` : `TOPIC: ${task.topic}`}
                                      </span>
                                  </div>
                                  <span className={`text-xs px-2 py-0.5 rounded font-mono font-bold
                                      ${task.status === TaskStatus.COMPLETED ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'}
                                  `}>
                                      {task.status}
                                  </span>
                              </div>
                              
                              {/* Progress Bar */}
                              <div className="space-y-1">
                                  <div className="flex justify-between text-xs text-slate-500 font-mono">
                                      <span>{activeMode === UserMode.PROVIDER ? `Remote: ${task.workerName}` : `From: ${task.requesterName}`}</span>
                                      <span>{task.progress}%</span>
                                  </div>
                                  <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                                      <div 
                                        className={`h-full transition-all duration-300 ${task.status === TaskStatus.COMPLETED ? 'bg-emerald-500' : 'bg-cyan-500'}`} 
                                        style={{ width: `${task.progress}%` }}
                                      ></div>
                                  </div>
                              </div>
                              
                              {/* Output Console */}
                              {task.status === TaskStatus.COMPLETED && task.resultData && (
                                  <div className="mt-2 p-2 bg-black rounded border border-slate-800 font-mono text-xs text-emerald-300 break-all">
                                      <div className="text-slate-500 mb-1 border-b border-slate-800 pb-1">Output Console:</div>
                                      <span className="text-emerald-300">{task.resultData}</span>
                                  </div>
                              )}
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      </div>

      {/* Code Input Modal */}
      {isTaskModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
              <div className="bg-slate-900 border border-slate-600 w-full max-w-lg rounded-xl shadow-2xl overflow-hidden">
                  <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
                      <div className="flex items-center gap-2 text-white font-mono font-bold">
                          <Terminal className="w-4 h-4 text-cyan-400" />
                          DEPLOY SCRIPT
                      </div>
                      <button onClick={() => setIsTaskModalOpen(false)} className="text-slate-400 hover:text-white">
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  <div className="p-4">
                      <p className="text-xs text-slate-400 mb-2">Write Python code to execute on the remote node:</p>
                      <textarea
                          value={pythonCode}
                          onChange={(e) => setPythonCode(e.target.value)}
                          className="w-full h-40 bg-slate-950 border border-slate-700 text-emerald-400 font-mono text-sm p-3 rounded focus:border-cyan-500 focus:outline-none resize-none"
                          spellCheck={false}
                      />
                  </div>
                  <div className="p-4 border-t border-slate-700 bg-slate-800/30 flex justify-end gap-3">
                      <button 
                          onClick={() => setIsTaskModalOpen(false)}
                          className="px-4 py-2 rounded text-slate-300 hover:bg-slate-800 text-sm font-bold"
                      >
                          CANCEL
                      </button>
                      <button 
                          onClick={submitTask}
                          className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold flex items-center gap-2"
                      >
                          <UploadCloud className="w-4 h-4" />
                          BROADCAST TASK
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Dashboard;
