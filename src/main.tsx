import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { init, hookFocus } from './sync/engine';
import './styles.css';

class Boundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div className="setup"><div className="card">
          <h2>Something went wrong drawing this screen</h2>
          <p className="hint">{this.state.err.message}</p>
          <button className="btn primary" onClick={() => { this.setState({ err: null }); }}>Try again</button>
        </div></div>
      );
    }
    return this.props.children;
  }
}

init();
hookFocus();
ReactDOM.createRoot(document.getElementById('root')!).render(<Boundary><App /></Boundary>);
