import { createRoot } from 'react-dom/client';
import FlowApp from './FlowApp.tsx';
import '../src/index.css';
import './proto.css';

createRoot(document.getElementById('root')!).render(<FlowApp />);
