# @tarxemo/api-client

[![npm version](https://img.shields.io/npm/v/@tarxemo/api-client.svg)](https://www.npmjs.com/package/@tarxemo/api-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A production-ready Apollo Client wrapper with automatic token refresh, intelligent error handling, and built-in notification support. Perfect for React applications that need robust GraphQL API integration with authentication.

## Features

✅ **Automatic Token Refresh** - Seamlessly refreshes expired access tokens using refresh tokens  
✅ **Smart Error Handling** - Catches authentication errors and retries requests automatically  
✅ **Built-in Notifications** - Integrates with your notification system for user feedback  
✅ **Request Queuing** - Queues requests during token refresh to prevent race conditions  
✅ **Configurable Retry Logic** - Customizable retry attempts and delays  
✅ **TypeScript Support** - Full TypeScript definitions included  
✅ **Storage Agnostic** - Works with localStorage, sessionStorage, or custom storage  
✅ **SSR Compatible** - Safe to use in server-side rendering environments

## Installation

```bash
npm install @tarxemo/api-client
```

### Peer Dependencies

```bash
npm install @apollo/client graphql
```

## Quick Start

### Basic Setup

```typescript
import { ApiClient } from '@tarxemo/api-client';

// Create API client
const apiClient = new ApiClient({
  graphqlUrl: 'https://api.example.com/graphql',
  onSessionExpired: () => {
    // Redirect to login or show login modal
    window.location.href = '/login';
  },
  notificationHandler: ({ type, message }) => {
    // Integrate with your toast/notification system
    toast[type](message);
  }
});

// Get the Apollo Client instance
const client = apiClient.getClient();

// Use with Apollo Provider
import { ApolloProvider } from '@apollo/client';

function App() {
  return (
    <ApolloProvider client={client}>
      {/* Your app */}
    </ApolloProvider>
  );
}
```

### Making Queries and Mutations

```typescript
// Using the wrapper methods
const data = await apiClient.query(`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
      email
    }
  }
`, { id: '123' });

// Using mutations
const result = await apiClient.mutate(`
  mutation UpdateProfile($input: UpdateProfileInput!) {
    updateProfile(input: $input) {
      response {
        status
        message
      }
      data {
        id
        name
      }
    }
  }
`, { input: { name: 'John Doe' } });
```

## Configuration

### ApiClientConfig

```typescript
interface ApiClientConfig {
  // Required
  graphqlUrl: string;                    // Your GraphQL endpoint
  onSessionExpired: () => void;          // Callback when session expires
  
  // Optional
  notificationHandler?: NotificationHandler;  // Toast/notification handler
  storage?: Storage;                          // Default: window.localStorage
  tokenStorageKeys?: {
    accessToken?: string;                     // Default: 'access_token'
    refreshToken?: string;                    // Default: 'refresh_token'
  };
  retryConfig?: {
    maxRetries?: number;                      // Default: 3
    retryDelay?: number;                      // Default: 1000ms
  };
  headers?: Record<string, string>;           // Custom headers for all requests
}
```

### Complete Configuration Example

```typescript
const apiClient = new ApiClient({
  graphqlUrl: process.env.REACT_APP_GRAPHQL_URL!,
  
  onSessionExpired: () => {
    // Clear user state
    localStorage.clear();
    // Redirect to login
    window.location.href = '/login';
  },
  
  notificationHandler: ({ type, message, duration = 3000 }) => {
    // Using react-hot-toast
    toast[type](message, { duration });
  },
  
  storage: window.localStorage, // or sessionStorage
  
  tokenStorageKeys: {
    accessToken: 'my_access_token',
    refreshToken: 'my_refresh_token'
  },
  
  retryConfig: {
    maxRetries: 5,
    retryDelay: 2000 // 2 seconds
  },
  
  headers: {
    'X-Client-Version': '1.0.0',
    'X-Platform': 'web'
  }
});
```

## API Reference

### Class: ApiClient

#### Constructor

```typescript
new ApiClient(config: ApiClientConfig)
```

Creates a new API client instance with the specified configuration.

#### Methods

##### `getClient(): ApolloClient`

Returns the underlying Apollo Client instance for direct use with Apollo hooks.

```typescript
const client = apiClient.getClient();

// Use with Apollo hooks
import { useQuery, gql } from '@apollo/client';

const { data, loading } = useQuery(gql`
  query GetUsers {
    users {
      id
      name
    }
  }
`);
```

##### `query<T>(query: string, variables?: any): Promise<T>`

Execute a GraphQL query.

**Parameters:**
- `query` - GraphQL query string
- `variables` - Query variables (optional)

**Returns:** Promise resolving to query data

**Throws:** `GraphQLApiError` on error

```typescript
const data = await apiClient.query(`
  query GetPosts($limit: Int!) {
    posts(limit: $limit) {
      id
      title
      author {
        name
      }
    }
  }
`, { limit: 10 });
```

##### `mutate<T>(mutation: string, variables?: any): Promise<T>`

Execute a GraphQL mutation.

**Parameters:**
- `mutation` - GraphQL mutation string
- `variables` - Mutation variables (optional)

**Returns:** Promise resolving to mutation data

**Throws:** `GraphQLApiError` on error

```typescript
const result = await apiClient.mutate(`
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      response {
        status
        message
      }
      data {
        id
        title
      }
    }
  }
`, { input: { title: 'New Post', content: '...' } });
```

##### `setAuthToken(accessToken: string, refreshToken: string): Promise<void>`

Manually set authentication tokens (useful after login).

```typescript
// After successful login
const { accessToken, refreshToken } = loginResponse;
await apiClient.setAuthToken(accessToken, refreshToken);
```

##### `clearAuthTokens(): Promise<void>`

Clear all authentication tokens and reset Apollo cache.

```typescript
// On logout
await apiClient.clearAuthTokens();
```

##### `isAuthenticated(): Promise<boolean>`

Check if user has valid tokens stored.

```typescript
const isLoggedIn = await apiClient.isAuthenticated();
if (!isLoggedIn) {
  // Redirect to login
}
```

### Notification Handler

```typescript
interface NotificationHandler {
  (input: {
    type: 'success' | 'error' | 'info' | 'warning';
    message: string;
    duration?: number;
    position?: string;
  }): void;
}
```

### Error Handling

The library throws `GraphQLApiError` for GraphQL and network errors:

```typescript
try {
  const data = await apiClient.query(QUERY);
} catch (error) {
  if (error instanceof GraphQLApiError) {
    console.error('API Error:', error.message);
    console.error('Status Code:', error.statusCode);
  }
}
```

## Advanced Usage

### Controlling Notifications Per Request

Use Apollo Client context to control notification behavior:

```typescript
import { useQuery } from '@apollo/client';

// Disable all notifications
const { data } = useQuery(QUERY, {
  context: { notify: 'none' }
});

// Only show success notifications
const { data } = useQuery(MUTATION, {
  context: { notify: 'success-only' }
});

// Only show error notifications
const { data } = useQuery(MUTATION, {
  context: { notify: 'error-only' }
});

// Show all notifications (default)
const { data } = useQuery(MUTATION, {
  context: { notify: true }
});
```

### Custom Storage Implementation

```typescript
// Use sessionStorage instead of localStorage
const apiClient = new ApiClient({
  graphqlUrl: API_URL,
  storage: window.sessionStorage,
  onSessionExpired: handleSessionExpired
});

// Custom storage implementation
class CustomStorage implements Storage {
  private data: Map<string, string> = new Map();
  
  get length() { return this.data.size; }
  
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  
  removeItem(key: string): void {
    this.data.delete(key);
  }
  
  clear(): void {
    this.data.clear();
  }
  
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }
}

const apiClient = new ApiClient({
  graphqlUrl: API_URL,
  storage: new CustomStorage(),
  onSessionExpired: handleSessionExpired
});
```

### Integration with React Context

```typescript
// Create API context
import { createContext, useContext } from 'react';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const apiClient = useMemo(() => new ApiClient({
    graphqlUrl: process.env.REACT_APP_GRAPHQL_URL!,
    onSessionExpired: () => {
      // Handle session expiry
    },
    notificationHandler: toast
  }), []);
  
  return (
    <ApolloProvider client={apiClient.getClient()}>
      <ApiContext.Provider value={apiClient}>
        {children}
      </ApiContext.Provider>
    </ApolloProvider>
  );
}

export function useApi() {
  const context = useContext(ApiContext);
  if (!context) {
    throw new Error('useApi must be used within ApiProvider');
  }
  return context;
}

// Usage in components
function MyComponent() {
  const api = useApi();
  
  const handleLogin = async (credentials) => {
    const result = await api.mutate(LOGIN_MUTATION, { input: credentials });
    if (result.login.response.status) {
      const { accessToken, refreshToken } = result.login.data;
      await api.setAuthToken(accessToken, refreshToken);
    }
  };
  
  return <LoginForm onSubmit={handleLogin} />;
}
```

## How Token Refresh Works

1. **Request Made**: Client makes a GraphQL request with access token
2. **Token Expired**: Server returns 401 or UNAUTHENTICATED error
3. **Automatic Refresh**: Library automatically calls refresh token mutation
4. **Queue Requests**: All pending requests are queued during refresh
5. **Update Token**: New access token is stored
6. **Retry Requests**: Original request and queued requests retry with new token
7. **Session Expired**: If refresh fails, `onSessionExpired` callback is triggered

### Refresh Token Mutation

The library expects this GraphQL mutation to be available:

```graphql
mutation RefreshToken($input: RefreshTokenInput!) {
  refreshToken(input: $input) {
    response {
      status
      message
    }
    data {
      accessToken
    }
  }
}
```

## Best Practices

### 1. Centralize API Client Creation

```typescript
// api/client.ts
import { ApiClient } from '@tarxemo/api-client';
import { toast } from 'react-hot-toast';

export const apiClient = new ApiClient({
  graphqlUrl: process.env.REACT_APP_GRAPHQL_URL!,
  onSessionExpired: () => {
    localStorage.clear();
    window.location.href = '/login';
  },
  notificationHandler: toast
});

export const apolloClient = apiClient.getClient();
```

### 2. Handle Session Expiry Gracefully

```typescript
onSessionExpired: () => {
  // Clear all app state
  localStorage.clear();
  sessionStorage.clear();
  
  // Show notification
  toast.error('Your session has expired. Please login again.');
  
  // Redirect after a delay
  setTimeout(() => {
    window.location.href = '/login';
  }, 2000);
}
```

### 3. Use TypeScript for Type Safety

```typescript
interface User {
  id: string;
  name: string;
  email: string;
}

interface GetUserResponse {
  user: User;
}

const data = await apiClient.query<GetUserResponse>(`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
      email
    }
  }
`, { id: '123' });

// data.user is typed as User
console.log(data.user.name);
```

### 4. Error Boundary Integration

```typescript
import { ErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error }: { error: Error }) {
  if (error instanceof GraphQLApiError) {
    return (
      <div>
        <h2>API Error</h2>
        <p>{error.message}</p>
        {error.statusCode && <p>Status: {error.statusCode}</p>}
      </div>
    );
  }
  return <div>Something went wrong</div>;
}

function App() {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <ApiProvider>
        {/* Your app */}
      </ApiProvider>
    </ErrorBoundary>
  );
}
```

## Troubleshooting

### Issue: "No refresh token available"

**Cause:** Refresh token not found in storage

**Solution:**
```typescript
// Ensure tokens are set after login
await apiClient.setAuthToken(accessToken, refreshToken);

// Check if tokens exist
const isAuth = await apiClient.isAuthenticated();
```

### Issue: Token refresh loop

**Cause:** Refresh token mutation also returns 401

**Solution:**
- Ensure refresh token is valid
- Check backend refresh token endpoint
- Verify token storage keys match

### Issue: Notifications not showing

**Cause:** Notification handler not configured

**Solution:**
```typescript
const apiClient = new ApiClient({
  graphqlUrl: API_URL,
  notificationHandler: ({ type, message }) => {
    // Make sure this is called
    console.log(type, message);
    toast[type](message);
  },
  onSessionExpired: () => {}
});
```

### Issue: SSR errors (window is not defined)

**Cause:** Accessing window.localStorage during SSR

**Solution:**
```typescript
const apiClient = new ApiClient({
  graphqlUrl: API_URL,
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  onSessionExpired: () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }
});
```

## TypeScript

Full TypeScript support with exported types:

```typescript
import {
  ApiClient,
  ApiClientConfig,
  GraphQLApiError,
  GraphQLError,
  NotificationHandler,
  NotificationType
} from '@tarxemo/api-client';
```

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Support

For issues or questions, please open an issue on GitHub.
# graphql-api-client
