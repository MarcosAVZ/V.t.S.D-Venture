// Local "production" run: serves the built client (client/dist) from the API server.
// NODE_ENV is set here, before index.js is loaded, so it works on Windows, macOS and Linux
// (no `NODE_ENV=production cmd` syntax, no cross-env).
process.env.NODE_ENV = 'production'

const { start } = await import('./index.js')
start()
