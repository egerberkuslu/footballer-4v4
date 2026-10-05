import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { failed: boolean }

// Model dosyasi yoksa tum sahne cokmesin, sadece model atlansin.
export class ModelBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
