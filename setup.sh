#!/usr/bin/env bash
set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${BLUE}HomeField Studio - Setup${NC}"
echo "----------------------------------------"

# Check dependencies
for cmd in docker openssl; do
  if ! command -v $cmd &>/dev/null; then
    echo -e "${RED}Error: $cmd is required but not installed.${NC}"
    exit 1
  fi
done

if ! docker compose version &>/dev/null; then
  echo -e "${RED}Error: docker compose (v2) is required but not available.${NC}"
  exit 1
fi

# Don't overwrite an existing env file
if [ -f homefield.env ]; then
  echo -e "${YELLOW}homefield.env already exists. Delete it first if you want to reconfigure.${NC}"
  exit 1
fi

echo ""
echo "You will be prompted for each required value."
echo "Press enter to accept a suggested default where shown."
echo ""

# AUTH_SECRET
AUTH_SECRET=$(openssl rand -base64 32)
echo -e "${GREEN}AUTH_SECRET${NC} auto-generated."

# AUTH_URL
echo ""
echo -e "${GREEN}AUTH_URL${NC} - The URL this app will be accessed from."
echo "  Examples: http://192.168.1.100:3000  |  https://homefield.yourdomain.com"
read -rp "  AUTH_URL: " AUTH_URL
while [ -z "$AUTH_URL" ]; do
  echo "  AUTH_URL is required."
  read -rp "  AUTH_URL: " AUTH_URL
done

# GOOGLE_APPLICATION_CREDENTIALS_JSON
echo ""
echo -e "${GREEN}GOOGLE_APPLICATION_CREDENTIALS_JSON${NC} - Your Google Cloud service account JSON."
echo "  Paste the entire contents of your service account key file as a single line."
read -rp "  Credentials JSON: " GOOGLE_APPLICATION_CREDENTIALS_JSON
while [ -z "$GOOGLE_APPLICATION_CREDENTIALS_JSON" ]; do
  echo "  This value is required."
  read -rp "  Credentials JSON: " GOOGLE_APPLICATION_CREDENTIALS_JSON
done

# GENERATION_PROVIDER
echo ""
echo -e "${GREEN}GENERATION_PROVIDER${NC} - Which AI provider to use for image generation."
echo "  Options: vertex (default, uses Google Vertex AI) | replicate"
read -rp "  Provider [vertex]: " GENERATION_PROVIDER
GENERATION_PROVIDER=${GENERATION_PROVIDER:-vertex}

# REPLICATE_API_TOKEN (only if replicate)
REPLICATE_API_TOKEN=""
if [ "$GENERATION_PROVIDER" = "replicate" ]; then
  echo ""
  echo -e "${GREEN}REPLICATE_API_TOKEN${NC} - Your Replicate API token."
  read -rp "  Replicate token: " REPLICATE_API_TOKEN
  while [ -z "$REPLICATE_API_TOKEN" ]; do
    echo "  Required when using replicate provider."
    read -rp "  Replicate token: " REPLICATE_API_TOKEN
  done
fi

# Write homefield.env
cat > homefield.env <<EOF
AUTH_SECRET=${AUTH_SECRET}
AUTH_TRUST_HOST=true
AUTH_URL=${AUTH_URL}
GOOGLE_APPLICATION_CREDENTIALS_JSON=${GOOGLE_APPLICATION_CREDENTIALS_JSON}
GENERATION_PROVIDER=${GENERATION_PROVIDER}
REPLICATE_API_TOKEN=${REPLICATE_API_TOKEN}
NODE_ENV=production
EOF

echo ""
echo -e "${GREEN}homefield.env written.${NC}"

# GHCR login
echo ""
echo -e "${GREEN}GitHub Container Registry login${NC}"
echo "  A GitHub Personal Access Token with 'read:packages' scope is required to pull the image."
echo "  Generate one at: GitHub > Settings > Developer settings > Personal access tokens"
echo ""
read -rp "  GitHub username: " GHCR_USER
read -rp "  GitHub PAT: " GHCR_TOKEN
echo ""

if echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin; then
  echo -e "${GREEN}GHCR login successful.${NC}"
else
  echo -e "${RED}GHCR login failed. Check your username and token.${NC}"
  exit 1
fi

# Pull and start
echo ""
echo "Pulling image and starting HomeField..."
docker compose -f docker-compose.homelab.yml pull
docker compose -f docker-compose.homelab.yml up -d

echo ""
echo -e "${GREEN}HomeField is running at ${AUTH_URL}${NC}"
echo ""
echo "  View logs:   docker compose -f docker-compose.homelab.yml logs -f"
echo "  Stop:        docker compose -f docker-compose.homelab.yml down"
echo ""
