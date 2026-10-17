import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import {createRoot} from 'react-dom/client'
import './style.css'
import App from './App'
import { createWailsStudioAPI } from './api/wails'
import { text } from './models/copy'
import { useStudioStore } from './stores/studio'

const container = document.getElementById('root')
if (!container) throw new Error('Studio root element is missing')

const root = createRoot(container)

class ApplicationErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null }

    static getDerivedStateFromError(error: Error) {
        return { error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        // Exception messages can contain values from service schemas/settings.
        // Keep the diagnostic useful without forwarding arbitrary payload text.
        console.error('Studio application render failed', { errorName: error.name, componentStack: info.componentStack })
    }

    render() {
        if (this.state.error) {
            const copy = text[useStudioStore.getState().locale]
            return <main className="application-error" role="alert">
                <h1>{copy.applicationErrorTitle}</h1>
                <p>{copy.applicationErrorBody}</p>
                <button type="button" className="secondary-button" onClick={() => { window.location.reload() }}>{copy.applicationErrorReload}</button>
            </main>
        }
        return this.props.children
    }
}

root.render(
    <React.StrictMode>
        <ApplicationErrorBoundary>
            <App api={createWailsStudioAPI()}/>
        </ApplicationErrorBoundary>
    </React.StrictMode>
)
