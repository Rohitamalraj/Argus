# Argus analyzer + demo seller on one small host. See docs/DEPLOY.md.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services ./services
COPY apps/seller-demo ./apps/seller-demo
COPY scripts ./scripts
COPY tsconfig.base.json vitest.shared.ts LICENSE ./
# the workspace lists apps/dashboard and scripts/*, which the image does not need
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.workspaces=['packages/*','services/*','apps/seller-demo'];fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
 && rm -f package-lock.json && npm install --no-audit --no-fund
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "scripts/start-hosted.mjs"]
