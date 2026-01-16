import {
    ApolloClient,
    InMemoryCache,
    HttpLink,
    from,
    gql,
    ApolloLink,
    Observable
} from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';

// Types
export interface GraphQLError {
    message: string;
    extensions?: Record<string, any>;
}

export class GraphQLApiError extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number) {
        super(message);
        this.name = 'GraphQLApiError';
        this.statusCode = statusCode;
    }
}

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface NotificationHandler {
    (input: { type: NotificationType; message: string; duration?: number; position?: string }): void;
}

export interface ApiClientConfig {
    graphqlUrl: string;
    onSessionExpired: () => void;
    notificationHandler?: NotificationHandler;
    storage?: Storage; // defaults to window.localStorage
    tokenStorageKeys?: {
        accessToken?: string;
        refreshToken?: string;
    };
    retryConfig?: {
        maxRetries?: number;
        retryDelay?: number;
    };
    headers?: Record<string, string>;
}

export class ApiClient {
    private client: any; // Use any to avoid Apollo Client version conflicts
    private config: ApiClientConfig;
    private maxRetries: number;
    private isRefreshing: boolean = false;
    private retryCount: number = 0;
    private pendingRequests: Array<{
        resolve: (value: any) => void;
        reject: (reason?: any) => void;
    }> = [];

    constructor(config: ApiClientConfig) {
        this.config = {
            storage: typeof window !== 'undefined' ? window.localStorage : undefined,
            tokenStorageKeys: {
                accessToken: 'access_token',
                refreshToken: 'refresh_token',
                ...config.tokenStorageKeys
            },
            retryConfig: {
                maxRetries: 3,
                retryDelay: 1000,
                ...config.retryConfig
            },
            ...config
        };
        this.maxRetries = this.config.retryConfig?.maxRetries || 3;
        this.client = this.createClient();
    }

    public getClient() {
        return this.client;
    }

    private notify(type: NotificationType, message: string) {
        if (this.config.notificationHandler) {
            this.config.notificationHandler({ type, message });
        }
    }

    // Helpers to parse standardized backend envelope
    private notifyFromEnvelope(
        result: any,
        opts?: { successType?: NotificationType; errorType?: NotificationType }
    ) {
        const { successType = 'success', errorType = 'error' }: { successType: NotificationType; errorType: NotificationType } = opts || {} as any;
        if (!result || typeof result !== 'object') return;
        const topKey = Object.keys(result)[0];
        if (!topKey) return;
        const payload = (result as any)[topKey];
        const resp = payload?.response;
        if (!resp) return;
        const status = resp.status;
        const message = resp.message || '';
        if (!message) return;
        this.notify(status ? successType : errorType, message);
    }


    private async refreshTokenAndRetry(operation: any, forward: any) {
        if (!this.isRefreshing) {
            this.isRefreshing = true;

            try {
                const refreshToken = this.config.storage?.getItem(
                    this.config.tokenStorageKeys?.refreshToken || 'refresh_token'
                );
                if (!refreshToken) {
                    throw new Error('No refresh token available');
                }

                const response = await fetch(this.config.graphqlUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(this.config.headers || {})
                    },
                    body: JSON.stringify({
                        query: `
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
            `,
                        variables: {
                            input: { refreshToken }
                        },
                    }),
                });

                if (!response.ok) {
                    throw new Error('Token refresh failed');
                }

                const result = await response.json();

                if (result.errors || result.data?.refreshToken?.response?.status !== true) {
                    throw new Error(result.errors?.[0]?.message || 'Token refresh failed');
                }

                const { accessToken } = result.data.refreshToken.data;
                this.config.storage?.setItem(
                    this.config.tokenStorageKeys?.accessToken || 'access_token', 
                    accessToken
                );

                // Reset retry count on successful refresh
                this.retryCount = 0;

                // Resolve pending requests
                this.pendingRequests.forEach(req => req.resolve(accessToken));
                this.pendingRequests = [];

                // Retry original operation
                operation.setContext({
                    headers: {
                        ...operation.getContext().headers,
                        Authorization: `Bearer ${accessToken}`,
                    },
                });

                return forward(operation);
            } catch (error) {
                console.error('Token refresh failed:', error);

                // Clear tokens and reject pending requests
                this.config.storage?.removeItem(
                    this.config.tokenStorageKeys?.accessToken || 'access_token'
                );
                this.config.storage?.removeItem(
                    this.config.tokenStorageKeys?.refreshToken || 'refresh_token'
                );
                this.pendingRequests.forEach(req => req.reject(error));
                this.pendingRequests = [];

                this.config.onSessionExpired();

                throw new GraphQLApiError('Session expired. Please login again.', 401);
            } finally {
                this.isRefreshing = false;
            }
        } else {
            // Queue the request if refresh is in progress
            return new Promise((resolve, reject) => {
                this.pendingRequests.push({ resolve, reject });
            }).then(token => {
                operation.setContext({
                    headers: {
                        ...operation.getContext().headers,
                        Authorization: `Bearer ${token}`,
                    },
                });
                return forward(operation);
            });
        }
    }

    private createClient() {
        const httpLink = new HttpLink({
            uri: this.config.graphqlUrl,
        });

        const authLink = setContext((_, { headers }) => {
            const token = this.config.storage?.getItem(
                this.config.tokenStorageKeys?.accessToken || 'access_token'
            );
            return {
                headers: {
                    ...headers,
                    Authorization: token ? `Bearer ${token}` : '',
                    ...(this.config.headers || {})
                },
            };
        });

        const errorLink = onError(({ graphQLErrors, networkError, operation, forward }) => {
            const ctx = operation.getContext?.() || {};
            const pref = ctx.notify;
            const allowErrors = !(pref === 'none' || pref === false || pref === 'success-only');

            if (graphQLErrors) {
                for (const err of graphQLErrors) {
                    if (
                        err.extensions?.code === 'UNAUTHENTICATED' ||
                        err.message.toLowerCase().includes('token') ||
                        err.message.toLowerCase().includes('unauthorized')
                    ) {
                        if (this.retryCount >= this.maxRetries) {
                            console.error('Max retries reached, redirecting to login');
                            this.config.storage?.removeItem('access_token');
                            this.config.storage?.removeItem('refresh_token');
                            this.config.onSessionExpired();
                            return;
                        }

                        this.retryCount++;
                        return new Observable((observer) => {
                            this.refreshTokenAndRetry(operation, forward)
                                .then((result: any) => {
                                    observer.next(result);
                                    observer.complete();
                                })
                                .catch((e: any) => observer.error(e));
                        });
                    }
                    console.error(`[GraphQL error]: ${err.message}`);
                    if (allowErrors && err.message) this.notify('error', err.message);
                }
            }

            if (networkError) {
                console.error('[Network error]:', networkError);

                if ('statusCode' in networkError && (networkError as any).statusCode === 401) {
                    if (this.retryCount >= this.maxRetries) {
                        console.error('Max retries reached, redirecting to login');
                        this.config.storage?.removeItem('access_token');
                        this.config.storage?.removeItem('refresh_token');
                        this.config.onSessionExpired();
                        return;
                    }

                    this.retryCount++;
                    return new Observable((observer) => {
                        this.refreshTokenAndRetry(operation, forward)
                            .then((result: any) => {
                                observer.next(result);
                                observer.complete();
                            })
                            .catch((e: any) => observer.error(e));
                    });
                }

                const msg = (networkError as any)?.message || 'Network error';
                if (allowErrors && msg) this.notify('error', msg);
            }
        });

        const notifyLink = new ApolloLink((operation, forward) => {
            return new Observable((observer) => {
                const sub = forward(operation).subscribe({
                    next: (result) => {
                        try {
                            const isMutation = operation.query.definitions.some(
                                (d: any) => d.kind === 'OperationDefinition' && d.operation === 'mutation'
                            );
                            if (isMutation && result && (result as any).data) {
                                const ctx = operation.getContext?.() || {};
                                const pref = ctx.notify;
                                if (pref === 'none' || pref === false) {
                                    // do nothing
                                } else if (pref === 'success-only' || pref === 'error-only') {
                                    const data: any = (result as any).data;
                                    const topKey = data && Object.keys(data)[0];
                                    const resp = topKey ? data[topKey]?.response : undefined;
                                    const status = !!resp?.status;
                                    if ((pref === 'success-only' && status) || (pref === 'error-only' && !status)) {
                                        this.notifyFromEnvelope(data);
                                    }
                                } else {
                                    this.notifyFromEnvelope((result as any).data);
                                }
                            }
                        } catch { }
                        observer.next(result);
                    },
                    error: (e) => observer.error(e),
                    complete: () => observer.complete(),
                });
                return () => sub.unsubscribe();
            });
        });

        return new ApolloClient({
            link: from([errorLink, authLink, notifyLink, httpLink]),
            cache: new InMemoryCache(),
            defaultOptions: {
                watchQuery: {
                    errorPolicy: 'all',
                    fetchPolicy: 'cache-and-network',
                },
                query: {
                    errorPolicy: 'all',
                    fetchPolicy: 'network-only',
                },
                mutate: {
                    errorPolicy: 'all',
                },
            },
        });
    }

    // Wrapper methods
    async query<T = any>(query: string, variables?: any): Promise<T> {
        try {
            const result = await this.client.query({
                query: gql(query),
                variables,
            });

            if (result.errors && result.errors.length > 0) {
                throw new GraphQLApiError(result.errors[0].message);
            }

            return result.data;
        } catch (error) {
            if (error instanceof GraphQLApiError) throw error;
            console.error('GraphQL Query Error:', error);
            throw new GraphQLApiError('Network error occurred');
        }
    }

    async mutate<T = any>(mutation: string, variables?: any): Promise<T> {
        try {
            const result = await this.client.mutate({
                mutation: gql(mutation),
                variables,
            });

            if (result.errors && result.errors.length > 0) {
                throw new GraphQLApiError(result.errors[0].message);
            }

            if (!result.data) {
                throw new GraphQLApiError('No data returned from mutation');
            }

            return result.data;
        } catch (error) {
            if (error instanceof GraphQLApiError) throw error;
            console.error('GraphQL Mutation Error:', error);
            throw new GraphQLApiError('Network error occurred');
        }
    }

    async setAuthToken(accessToken: string, refreshToken: string): Promise<void> {
        this.config.storage?.setItem('access_token', accessToken);
        this.config.storage?.setItem('refresh_token', refreshToken);
    }

    async clearAuthTokens(): Promise<void> {
        this.config.storage?.removeItem('access_token');
        this.config.storage?.removeItem('refresh_token');
        await this.client.clearStore();
    }

    async isAuthenticated(): Promise<boolean> {
        const token = this.config.storage?.getItem('access_token');
        const refreshToken = this.config.storage?.getItem('refresh_token');
        return !!(token && refreshToken);
    }
}
