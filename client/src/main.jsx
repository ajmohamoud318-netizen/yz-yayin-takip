import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './hooks/useAuth.js'
import { ProjectsProvider } from './hooks/useProjectsStore.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ProjectsProvider>
          <App />
        </ProjectsProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
