# Dex for the cluster (ADR-0010): served at /dex on the dashboard's host, signing people in with GitHub, members of
# GITHUB_ORG only; their teams there arrive as groups ("<org>:<team>"), which DP-16 maps to roles. Rendered by the
# image's entrypoint (gomplate) from the environment the Deployment sets, its secrets included. Sessions and keys are
# in memory: a restart signs no one out of the dashboard, whose sessions are its own, and only fails a sign-in under way.
issuer: {{ getenv "DEX_ISSUER" }}
storage:
  type: memory
web:
  http: 0.0.0.0:5556
telemetry:
  http: 0.0.0.0:5558
oauth2:
  skipApprovalScreen: true
staticClients:
  - id: cwa-dashboard
    name: CWA dashboard
    secret: {{ getenv "DEX_CLIENT_SECRET" }}
    redirectURIs:
      - {{ getenv "DEX_REDIRECT" }}
connectors:
  - type: github
    id: github
    name: GitHub
    config:
      clientID: {{ getenv "GITHUB_CLIENT_ID" }}
      clientSecret: {{ getenv "GITHUB_CLIENT_SECRET" }}
      redirectURI: {{ getenv "DEX_ISSUER" }}/callback
      orgs:
        - name: {{ getenv "GITHUB_ORG" }}
      teamNameField: slug
