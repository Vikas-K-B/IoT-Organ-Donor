export enum UserMode {
  IDLE = 'IDLE',
  PROVIDER = 'PROVIDER', // Running Task / CPU Overload
}

export interface User {
  id: string;
  username: string;
  points: number;
  mode: UserMode;
  cpuUsage: number;
  memoryUsage: number;
  isLocal: boolean;
  lastSeen?: number; // For network discovery
}

export enum TaskStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface Task {
  id: string;
  title: string;
  description: string; // Used for the Python Code
  codeSnippet?: string; // The actual python code
  requesterId: string;
  requesterName: string;
  workerId?: string;
  workerName?: string;
  status: TaskStatus;
  progress: number; // 0 to 100
  reward: number;
  resultData?: string;
  txHash?: string; // Ganache Transaction Hash
  topic?: string; // MQTT Topic
}

// Network Protocol Types
export type MessageType = 'HELLO' | 'HEARTBEAT' | 'TASK_OFFER' | 'TASK_ACCEPT' | 'TASK_PROGRESS' | 'TASK_COMPLETE';

export interface NetworkMessage {
  type: MessageType;
  sender: User;
  targetId?: string; // If null, broadcast to all
  payload?: any;
  timestamp: number;
}