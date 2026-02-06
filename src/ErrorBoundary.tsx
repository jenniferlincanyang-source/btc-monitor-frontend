import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40,
          textAlign: 'center',
          color: '#f85149',
          background: '#161b22',
          borderRadius: 12,
          margin: 20,
        }}>
          <h2>组件加载出错</h2>
          <p style={{ color: '#8b949e', marginTop: 8 }}>
            {this.state.error?.message}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: 16,
              padding: '8px 20px',
              background: '#58a6ff',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
