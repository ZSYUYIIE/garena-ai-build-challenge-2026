import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { MicrophonePermissionPage } from './components/MicrophonePermissionPage';
import { isMicrophonePermissionPage } from '../services/microphonePermission';
import './index.css';

const Root = isMicrophonePermissionPage(window.location.search)
  ? MicrophonePermissionPage
  : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
