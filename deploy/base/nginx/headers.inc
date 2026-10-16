# Security headers, included by every location in dashboard.conf: an add_header in a location replaces the server's
# set, so they are repeated there. The Content Security Policy is apps/web/dev/csp.ts's, which the dev and preview
# servers send and the browser tests run under; a test holds this line to it (apps/web/dev/deploy.test.ts).
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "DENY" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
