import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { mockSource } from './data/sources'
import { awsIotSource } from './cloud/iot'
import { initCloudCommands, hydrateControl } from './cloud/commands'

// the local engine starts with the page; AWS IoT Core takes over when its frames arrive
void mockSource.start()
initCloudCommands()
void awsIotSource.start().then(hydrateControl)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
