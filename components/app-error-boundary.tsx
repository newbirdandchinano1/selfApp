import React from 'react';
import { Pressable, Text, View } from 'react-native';

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.warn('AppErrorBoundary caught:', error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 24,
            backgroundColor: '#ffffff',
          }}>
          <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>出了点问题</Text>
          <Text style={{ fontSize: 14, opacity: 0.7, textAlign: 'center', marginBottom: 16 }}>
            {this.state.error?.message?.trim() || '应用遇到意外错误，请重试。'}
          </Text>
          <Pressable
            onPress={this.handleRetry}
            style={({ pressed }) => ({
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 12,
              borderWidth: 1,
              opacity: pressed ? 0.8 : 1,
            })}>
            <Text style={{ fontSize: 14, fontWeight: '700' }}>重试</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}
