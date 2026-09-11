import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles.css'
import './workbench-presentation.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App presentation={new URLSearchParams(window.location.search).get('workbench') === 'integrated' ? 'workbench' : 'default'} />
  </React.StrictMode>,
)
