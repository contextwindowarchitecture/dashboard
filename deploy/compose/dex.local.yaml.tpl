# Dex for the local stack (docker-compose.signin.yml, ADR-0010): served at /dex behind the web container's proxy,
# with Dex's mock connector, which signs a fixed test person in (Kilgore Trout, of the group "authors") with no
# password. Rendered by the image's entrypoint (gomplate) from the environment compose sets. Never for a deployment.
issuer: {{ getenv "DEX_ISSUER" }}
storage:
  type: memory
web:
  http: 0.0.0.0:5556
oauth2:
  skipApprovalScreen: true
staticClients:
  - id: cwa-dashboard
    name: CWA dashboard
    secret: {{ getenv "DEX_CLIENT_SECRET" }}
    redirectURIs:
      - {{ getenv "DEX_REDIRECT" }}
connectors:
  - type: mockCallback
    id: mock
    name: Test sign-in
