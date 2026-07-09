# 多人 Web 德州 + WebRTC 参考项目

这是一个 C++ 后端 + Web 前端 + mediasoup SFU 的多人德州 Hold'em 项目骨架：

- C++20 / Boost.Beast 提供 HTTP 静态资源服务和 WebSocket。
- C++ 后端负责房间、座位、牌局状态、下注轮次、广播和 WebRTC 信令转发。
- 浏览器前端负责桌面 UI、牌局操作、WebSocket 通信和 mediasoup 音视频接入。
- 音视频走独立 mediasoup SFU；C++ 后端只负责牌局，不转发媒体流。
- 支持标准德州和短牌 6+ 两种玩法。

## 依赖

C++ 服务依赖：

```bash
sudo apt-get install -y build-essential cmake libboost-system-dev
```

音视频依赖：

- Node.js 22+，用于运行 mediasoup 信令/SFU 服务。
- HTTPS/WSS 域名证书，手机浏览器访问摄像头/麦克风必须使用安全上下文。
- 生产环境建议准备 TURN 能力，并正确配置公网 `MEDIASOUP_ANNOUNCED_IP`。

## 编译运行

```bash
cmake -S . -B build
cmake --build build -j
./build/web_texas_webrtc :: 8080
```

打开：

```text
http://localhost:8080
```

多开几个浏览器窗口，输入同一个房间号即可测试多人牌局和 WebRTC 连接。

本地音视频需要先启动 mediasoup 服务：

```bash
cd mediasoup-server
npm install
npm start
```

默认配置：

```text
MEDIASOUP_SIGNAL_PORT=3001
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=<自动探测的局域网 IP>
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=49999
```

前端 mediasoup 信令地址在 `web/config.js`：

```js
window.DZ_CONFIG = {
  mediasoupUrl: 'auto',
};
```

`auto` 会在本地 HTTP 开发时连接 `ws://<当前主机>:3001`，在 HTTPS 公网部署时连接同域名下的 `wss://<当前主机>/mediasoup`。

## 业务逻辑

项目可以按 4 条主线理解：连接、房间、牌局、音视频。

### 1. 连接层

- 浏览器打开页面后连接 `/ws`。
- C++ 服务端创建一个 `WsSession`，分配玩家临时 id，例如 `p1`。
- 后续所有业务消息都走 WebSocket JSON。
- HTTP 只负责返回 `web/` 下的静态页面、样式和脚本。

核心代码：

- `HttpSession`: 处理 HTTP 请求和 WebSocket upgrade。
- `WsSession`: 维护单个浏览器连接，负责异步收发。
- `GameHub`: 管理所有连接、房间、广播和消息分发。

### 2. 房间层

玩家提交：

```json
{"type":"join","room":"demo","name":"Alice"}
```

服务端处理流程：

1. 根据 `room` 找到或创建房间。
2. 把当前连接加入房间玩家列表。
3. 给当前玩家返回 `welcome`。
4. 给房间内所有玩家广播 `peer-joined`。
5. 广播最新 `state`。

房间当前只保存在内存里，服务重启后会清空。玩家断线时会从房间移除，如果房间没人了，房间对象也会被删除。

房间成员和牌局玩家是分开的：

- 所有房间成员都能看到牌桌、玩家状态、公共牌和牌桌记录。
- 玩家可以切换到旁观状态，继续留在房间内观看。
- 旁观玩家不会在下一手被发牌，也不会下盲注或获得行动权。
- 如果玩家在一手牌进行中切换旁观，服务端会把他视为弃牌，本手不再参与。
- 玩家回到牌局后，从下一手开始重新参与。
- 同一个连接重新加入其他房间时，会从旧房间移除，避免同时出现在多个房间。

房间内筹码转移：

- 客户端发送 `transfer` 可以把筹码转给同房间其他玩家。
- 为避免影响当前手牌公平性，筹码转移只允许在 `waiting` 状态进行。
- 转移成功后，服务端广播最新玩家筹码和牌桌事件。

房间玩法：

- 房间支持 `holdem` 标准德州和 `shortdeck` 短牌 6+。
- 玩法只能在 `waiting` 状态切换，一手牌开始后本手规则锁定。
- 前端房间面板可以切换玩法，帮助按钮会显示当前玩法的牌型大小。

### 3. 牌局层

牌局状态主要由 `Room` 保存：

- `players`: 玩家、筹码、当前下注、是否弃牌、手牌。
- `committed`: 玩家本手累计投入，用于主池和边池切分。
- `sittingOut`: 玩家是否暂时旁观。
- `mode`: 当前玩法，`holdem` 或 `shortdeck`。
- `deck`: 洗好的牌堆。
- `community`: 公共牌。
- `phase`: 当前阶段，包含 `waiting`、`preflop`、`flop`、`turn`、`river`、`showdown`。
- `dealer`: 庄家位置。
- `current`: 当前行动玩家位置。
- `highest_bet`: 当前轮最高下注。
- `min_raise`: 当前轮最小加注额，默认一个大盲；完整加注后会更新为本次加注差额。
- `pot`: 底池。
- `acted`: 本轮已经行动过的玩家。

开局流程：

1. 至少 2 名未旁观且有筹码的玩家才能开局。
2. 当前房间必须处于 `waiting` 状态，牌局中不能重复开局。
3. 洗牌。
4. 每名玩家发 2 张手牌。
5. 庄家按钮移动到下一位。
6. 小盲和大盲自动下注。
7. 行动权从大盲后一位开始。
8. 广播公共状态，并单独发送每个玩家自己的手牌。

行动流程：

客户端发送：

```json
{"type":"action","action":"call","amount":20}
```

支持的动作：

- `fold`: 弃牌。
- `check`: 过牌，只有无需跟注时有效。
- `call`: 跟到当前最高下注，已有下注差额时才有效；筹码不足时会 all-in 跟注。
- `raise`: 加注到 `amount`，这里的 `amount` 是本轮自己的总下注额，不是“再加多少”。

加注规则：

- 如果当前轮没人下注，第一次下注至少到一个大盲，短筹码可以 all-in。
- 如果已经有人下注，完整加注至少到 `highestBet + minRaise`。
- 如果玩家筹码不足以完成最小加注，可以 all-in 到自己的最大可下注额。
- 短 all-in 会提高其他玩家需要跟注的金额，但不会按完整加注重置最小加注额。
- 完整加注会更新 `minRaise`，并让其他未弃牌、未 all-in 玩家重新获得响应机会。

每次行动后服务端会：

1. 校验是不是当前玩家行动。
2. 修改玩家下注、筹码、弃牌或 all-in 状态。
3. 判断是否只剩一名未弃牌玩家。
4. 判断当前下注轮是否结束。
5. 必要时进入下一阶段并发公共牌。
6. 如果剩余玩家都 all-in，会自动发完公共牌并进入摊牌。
7. 广播最新 `state` 和 `event`。

摊牌结算：

- 服务端会从每名未弃牌玩家的 2 张手牌 + 5 张公共牌中枚举最佳 5 张牌。
- 标准德州牌型比较顺序为：同花顺、四条、葫芦、同花、顺子、三条、两对、一对、高牌。
- 短牌 6+ 牌型比较顺序为：同花顺、四条、同花、葫芦、三条、顺子、两对、一对、高牌。
- 短牌只使用 6 到 A 共 36 张牌，A 可以组成 A-6-7-8-9 顺子。
- 每名玩家本手累计投入记录在 `committed`。
- 结算时按不同 `committed` 层级切主池和边池。
- 已弃牌玩家的投入仍留在对应底池内，但不能参与赢池。
- 同牌型同踢脚时平分对应底池，无法整除的余数按当前座位顺序补给赢家。

### 4. 状态广播

服务端广播两类状态：

公共状态 `state` 会发给房间内所有玩家：

```json
{
  "type": "state",
  "room": "demo",
  "phase": "flop",
  "mode": "shortdeck",
  "pot": 120,
  "highestBet": 40,
  "minRaise": 20,
  "smallBlind": 10,
  "bigBlind": 20,
  "dealer": "p1",
  "toAct": "p2",
  "community": ["As", "Th", "7d"],
  "players": [
    {"id":"p1","name":"Alice","chips":1960,"bet":40,"committed":80,"folded":false,"allIn":false}
  ]
}
```

私有状态 `private` 只发给对应玩家：

```json
{"type":"private","cards":["Ah","Kd"]}
```

这样可以避免把其他玩家手牌泄露给前端。

## 音视频说明

本项目的音视频是“浏览器 + mediasoup-client + mediasoup Node 服务”模式：

1. 用户加入牌局房间。
2. 前端连接 `web/config.js` 中的 `mediasoupUrl`。
3. 前端发送 `join`，mediasoup 服务按房间创建或复用 Router。
4. 浏览器创建发送/接收 WebRTC transport。
5. 浏览器把摄像头/麦克风 publish 成 producer。
6. 同房间其他玩家收到 `newProducer` 后创建 consumer 订阅。

这样多人桌不再是浏览器两两 mesh。每个玩家通常只上传一路音视频，mediasoup 负责按房间分发。

音视频业务流程：

1. 玩家入座后，前端连接 mediasoup 信令服务。
2. 前端启用摄像头和麦克风。
3. 本地视频显示在 `localVideo`。
4. 远端玩家发布的轨道会显示到 `remoteVideos`。
5. 玩家离开 mediasoup 房间时，远端视频自动移除。

C++ 服务端不处理音视频编码、解码和转发，只负责牌局状态和房间业务。

## 部署

### 部署选择

当前提供两种部署路径：

- Linux 原生/systemd：最适合公网 IPv6 生产机，脚本会安装依赖、编译 C++、配置 Caddy 和 systemd。
- Docker Compose：适合 Linux x86_64、Linux ARM64、macOS 测试环境；同一套 Compose 编排 C++、mediasoup 和 Caddy。

### GitHub Actions 构建产物

仓库包含 `.github/workflows/build.yml`。push 到 GitHub 后会自动构建：

- `dz-linux-x64.tar.gz`: Ubuntu 24.04 x64 原生运行包，包含 C++ 服务、Web 静态文件、mediasoup 服务和已安装的 Node 依赖。
- Docker Compose build 校验：验证 `deploy/docker/Dockerfile.game` 和 `deploy/docker/Dockerfile.mediasoup` 都能构建。

Linux artifact 解压后可先本地试跑：

```bash
tar -xzf dz-linux-x64.tar.gz
cd dz-linux-x64
cp deploy/dz.env.example deploy/dz.env
editor deploy/dz.env
./scripts/linux/run_native.sh deploy/dz.env
```

原生包仍需要目标机器安装对应运行环境：Node.js 22+ 和系统 C++/Boost 运行库；公网 HTTPS 入口还需要 Caddy。生产部署前请把环境文件里的 `DZ_DOMAIN` 和 `MEDIASOUP_ANNOUNCED_IP` 改成真实域名和公网地址。

### Docker Compose 部署

准备环境文件：

```bash
cp deploy/dz.container.env.example deploy/dz.container.env
editor deploy/dz.container.env
```

至少改：

```text
DZ_DOMAIN=dz.example.com
MEDIASOUP_ANNOUNCED_IP=2001:db8::10
```

容器示例默认发布 `40000-40100/udp,tcp`，适合小桌和测试；如果要承载更多并发，在 `deploy/dz.container.env` 里扩大 `MEDIASOUP_MAX_PORT`，并同步放行防火墙。

启动：

```bash
docker compose --env-file deploy/dz.container.env up -d --build
```

查看状态：

```bash
docker compose --env-file deploy/dz.container.env ps
docker compose --env-file deploy/dz.container.env logs -f
```

跨架构构建镜像示例：

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -f deploy/docker/Dockerfile.game -t your-registry/dz-game:latest --push .

docker buildx build --platform linux/amd64,linux/arm64 \
  -f deploy/docker/Dockerfile.mediasoup -t your-registry/dz-mediasoup:latest --push .
```

公网部署仍然需要域名 AAAA 记录、80/443 端口和 mediasoup 媒体端口。

### Linux 原生公网 IPv6 快速部署

推荐用一个带 AAAA 记录的域名访问公网 IPv6 服务器，例如：

```text
dz.example.com AAAA 2001:db8::10
```

浏览器摄像头/麦克风需要安全上下文，所以生产环境不要只裸跑 `http://[IPv6]:8080`；用 Caddy 自动签 HTTPS 证书最省事。

仓库已经提供部署模板：

```text
deploy/dz.env.example                 # Linux 原生生产环境变量
deploy/dz.container.env.example       # Docker Compose 环境变量
deploy/systemd/dz-game.service        # Linux C++ 牌局服务
deploy/systemd/dz-mediasoup.service   # Linux mediasoup 服务
deploy/docker/Dockerfile.game         # C++ 服务容器镜像
deploy/docker/Dockerfile.mediasoup    # mediasoup 容器镜像
deploy/caddy/Caddyfile                # Linux 原生 HTTPS + /mediasoup WSS 反代
deploy/caddy/Caddyfile.docker         # Docker Compose Caddy 配置
scripts/install_ipv6_host.sh          # Ubuntu/Debian 原生安装脚本
```

在服务器上执行：

```bash
sudo bash scripts/install_ipv6_host.sh
sudo editor /etc/dz/dz.env
sudo systemctl restart dz-game dz-mediasoup caddy
```

至少要改这两项：

```text
DZ_DOMAIN=dz.example.com
MEDIASOUP_ANNOUNCED_IP=2001:db8::10
```

防火墙放行：

- `80/tcp`、`443/tcp`: Caddy HTTPS 和证书签发。
- `40000-49999/udp,tcp`: mediasoup WebRTC 媒体端口。

脚本默认让 C++ 服务监听 `[::1]:8080`，mediasoup 信令监听 `[::1]:3001`，公网入口只暴露 Caddy；WebRTC 媒体端口由 mediasoup 直接对外监听 `::` 并通过 `MEDIASOUP_ANNOUNCED_IP` 告诉浏览器公网 IPv6 地址。

### 需要的东西

- 一台公网服务器。
- 一个带 AAAA 记录的域名即可：
  - `dz.example.com`: 牌局 Web 服务和 `/mediasoup` WSS 反代。
  - 如果要拆分，也可以额外准备 `media.example.com` 给 mediasoup 信令/SFU。
- Node.js 22+，用于部署 mediasoup 服务。
- Caddy 或 Nginx，用于 HTTPS/WSS。
- 开放防火墙端口：
  - `80/tcp`、`443/tcp`: HTTPS 和证书签发。
  - `3001/tcp`: mediasoup 信令服务；默认只监听本机 `[::1]`，不需要对公网开放。
  - `40000-49999/udp,tcp`: mediasoup WebRTC 媒体端口。
  - 如果单独配置 TURN，还需要对应 TURN 端口，例如 `3478/udp`、`3478/tcp`、`5349/tcp`。

### 推荐架构

```text
Browser
  | HTTPS/WSS
  v
Caddy/Nginx -> C++ dz service :8080

Browser
  | WSS/WebRTC/TURN
  v
mediasoup SFU service
```

牌局和音视频分开部署：

- C++ 服务管业务。
- mediasoup 管多人音视频转发。

### 牌局服务 HTTPS

示例 Caddyfile：

```caddyfile
dz.example.com {
  @mediasoup path /mediasoup*
  reverse_proxy @mediasoup [::1]:3001

  reverse_proxy [::1]:8080
}
```

启动 C++ 服务：

```bash
./build/web_texas_webrtc ::1 8080
```

前端配置：

```js
window.DZ_CONFIG = {
  mediasoupUrl: 'auto',
};
```

### mediasoup SFU

本地开发可以用：

```bash
cd mediasoup-server
npm install
npm start
```

生产启动示例：

```bash
cd mediasoup-server
MEDIASOUP_SIGNAL_PORT=3001 \
MEDIASOUP_SIGNAL_HOST=::1 \
MEDIASOUP_LISTEN_IP=:: \
MEDIASOUP_ANNOUNCED_IP=<服务器公网 IPv6，不加方括号> \
MEDIASOUP_PREFER_IPV6=true \
MEDIASOUP_MIN_PORT=40000 \
MEDIASOUP_MAX_PORT=49999 \
npm start
```

生产注意点：

- `MEDIASOUP_ANNOUNCED_IP` 必须是浏览器可访问的公网 IP 或正确的外网地址。
- `web/config.js` 的 `mediasoupUrl` 保持 `auto` 时，HTTPS 下默认使用同域名的 `wss://.../mediasoup`；如果拆出独立媒体域名，就改成公网可访问的完整 `wss://` 地址。
- 手机浏览器必须通过 `https://dz.example.com` 访问牌局页面，否则摄像头/麦克风会被浏览器拒绝。
- mediasoup 的媒体端口必须对公网开放，否则需要依赖 TURN。
- 如果玩家在复杂 NAT、公司网络或移动网络下，TURN/TLS 是稳定性的关键。

### 本地手机测试

如果手机访问：

```text
http://电脑IP:8080
```

摄像头/麦克风大概率不可用，因为不是 HTTPS。可选方案：

- 用 `localhost` 在电脑本机测试。
- 给局域网服务配本地可信 HTTPS 证书。
- 用 `ngrok`、`cloudflared tunnel` 这类工具临时提供 HTTPS 地址。
- 直接部署到有域名和 HTTPS 的公网服务器。

## 服务端模块划分

当前为了便于阅读，C++ 代码集中在 `src/main.cpp`。后续可以按下面方式拆分：

```text
src/
  main.cpp              # 启动 io_context 和 listener
  net/http_session.*    # HTTP 静态资源和 WebSocket upgrade
  net/ws_session.*      # WebSocket 连接收发
  game/game_hub.*       # 房间、连接、广播、信令分发
  game/room.*           # Room/Player/Card 数据结构
  game/poker_engine.*   # 发牌、下注轮、阶段推进、结算
  game/hand_eval.*      # 手牌评估器
```

生产项目里，建议让 `GameHub` 只做调度，把德州规则从网络层中拆出来。这样以后接数据库、鉴权、机器人或观战模式时不会把网络代码和牌局规则搅在一起。

## 协议消息

客户端发给服务端：

```json
{"type":"join","room":"demo","name":"Alice"}
{"type":"mode","mode":"shortdeck"}
{"type":"start"}
{"type":"action","action":"call","amount":20}
{"type":"sitout","sittingOut":true}
{"type":"transfer","to":"player-id","amount":100}
```

服务端会广播：

```json
{"type":"welcome","id":"...","room":"demo"}
{"type":"state","players":[{"id":"...","chips":1900,"committed":100,"sittingOut":false}],"community":[...],"pot":120,"toAct":"..."}
{"type":"event","message":"Alice call 20"}
{"type":"peer-joined","id":"...","name":"Alice"}
{"type":"peer-left","id":"..."}
```

## 当前范围

这是可运行的参考实现，不是生产级真钱牌局服务。生产化还需要：

- 更严格的回合状态机与断线重连。
- 服务端鉴权、房间权限、限流、防作弊审计。
- TLS/WSS 部署。
- 生产级 TURN 凭证签发、过期控制和连接质量监控。
