#!/usr/bin/env bash
# ==============================================================================
# setup_vps_nginx_certbot.sh
# 
# Production Nginx reverse-proxy & Let's Encrypt Certbot setup script for VPS.
# Run with: sudo bash setup_vps_nginx_certbot.sh [DOMAIN] [BACKEND_PORT]
# Example:  sudo bash setup_vps_nginx_certbot.sh api.tipitakapali.org 8400
# ==============================================================================

set -euo pipefail

DOMAIN="${1:-api.tipitakapali.org}"
PORT="${2:-8400}"

echo ">>> [1/6] Verifying root privileges..."
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Please run this script with sudo or as root:"
    echo "  sudo bash $0 $DOMAIN $PORT"
    exit 1
fi

echo ">>> [2/6] Creating webroot directory for Certbot ACME challenge..."
mkdir -p /var/www/certbot/.well-known/acme-challenge
chown -R www-data:www-data /var/www/certbot
chmod -R 755 /var/www/certbot
echo "✓ /var/www/certbot created and permissions set to 755 (owner: www-data)"

echo ">>> [3/6] Installing Nginx and Certbot if missing..."
if ! command -v nginx >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y nginx
fi

if ! command -v certbot >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y certbot python3-certbot-nginx
fi

echo ">>> [4/6] Creating initial HTTP-only Nginx configuration for ACME challenge..."
NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"

cat <<EOF > "$NGINX_CONF"
# ${DOMAIN} — HTTP configuration for ACME HTTP-01 validation
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    # Let's Encrypt HTTP-01 challenge location
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        try_files \$uri =404;
    }

    # Redirect all remaining traffic to HTTPS
    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF

ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/${DOMAIN}"

# Remove default site if present
if [ -f /etc/nginx/sites-enabled/default ]; then
    rm -f /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl reload nginx
echo "✓ Nginx reloaded with HTTP-01 challenge webroot support"

echo ">>> [5/6] Requesting SSL Certificate from Let's Encrypt..."
read -rp "Do you want to run certbot now for ${DOMAIN}? (y/N): " RUN_CERTBOT
if [[ "$RUN_CERTBOT" =~ ^[Yy]$ ]]; then
    certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --agree-tos --no-eff-email

    if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
        echo ">>> [6/6] Certificate issued! Writing complete HTTPS reverse-proxy config..."
        cat <<EOF > "$NGINX_CONF"
# ${DOMAIN} — Fastify Reverse Proxy with TLS
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        try_files \$uri =404;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_protocols TLSv1.2 TLSv1.3;

    gzip on;
    gzip_vary on;
    gzip_min_length 256;
    gzip_proxied any;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 300s;
    }
}
EOF
        nginx -t
        systemctl reload nginx
        echo "✓ Successfully configured and reloaded Nginx with HTTPS for https://${DOMAIN}"
    else
        echo "WARNING: Certificate was not found at /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
    fi
else
    echo "Skipped certbot certificate issuance. You can run it manually when DNS is ready:"
    echo "  sudo certbot certonly --webroot -w /var/www/certbot -d ${DOMAIN}"
fi

echo "=============================================================================="
echo "Setup complete!"
echo "=============================================================================="

