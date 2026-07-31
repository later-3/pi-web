# Later 设备新增、下线与密钥轮换手册

> 本文是生产操作手册。架构、命令和日常排障见 [`device-access.zh-CN.md`](./device-access.zh-CN.md)。
> 所有步骤默认从 Mac 的 `/Users/xulater/Code/pi-web` 发起；替换示例 id、账号和路径时必须先做只读探测。

## 1. 操作原则

1. Inventory 是唯一事实源；SSH config、云端 `permitopen` 和 relay 账号均由它派生。
2. 新设备使用独立 management key 和 relay key，不复制现有私钥。
3. 云端先 `--plan`，再 apply；保留一个已认证管理会话，直到第二个新会话测试成功。
4. Host key 必须从可信 LAN、控制台或已认证连接取得，不能盲目接受。
5. 部署分为“事实探测、配置生成、授权、服务安装、矩阵验收、归档提交”6 个阶段。
6. 任一阶段失败都停止，不用放宽 SSH 或公网暴露端口绕过。

## 2. 新设备前置检查

在可信的首次接入路径上检查，不做修改：

```bash
hostname
id
uname -a

# Linux
cat /etc/os-release
command -v ssh ssh-keygen jq systemctl
systemctl is-active ssh || systemctl is-active sshd
loginctl show-user "$USER" -p Linger

# macOS
sw_vers
nc -z 127.0.0.1 22
```

记录以下事实：

- 稳定设备 id，例如 `linux-lab`；
- 人类可读名称、角色、hostname、OS、arch；
- 登录账号与 sudo 方式；
- Pi Web/Pi Agent/项目路径；
- LAN 地址仅作为 `observedAddresses`；
- 是否需要 relay。没有稳定、受保护直连 SSH 的设备使用 `relay`。

停止条件：目标有未知工作区修改、sshd 未启用、磁盘/账号不明确、不能建立可信首次通道或需要用户 sudo 密码但用户不在场。

## 3. 分配唯一标识和端口

先查看现有拓扑：

```bash
later-device list
later-device topology
```

为新 relay 设备分配：

```text
device id:       linux-lab
SSH alias:       later-linux-lab
relay port:      33103
cloud account:   later-relay-linux-lab
host key alias:  later-device-linux-lab（由前缀 + id 自动派生）
```

规则：

- id：小写 slug，加入后不随 hostname/IP 改名；
- alias：全 inventory 唯一；
- relay port：`1024–65535`、全 inventory 唯一、云端只绑定 `127.0.0.1`；
- relay user：全 inventory 唯一、无交互 Shell；
- 不在 id、alias 或 user 中编码密码、Token 或 IP。

## 4. 在新设备生成独立 key

把本仓库或最小 runtime bundle 安全复制到新设备后运行：

```bash
./scripts/prepare-device-keys.sh linux-lab relay
```

输出会给出两个指纹和归档文件名：

```text
mesh_fingerprint=SHA256:...
archive_mesh_as=ops/device-public-keys/linux-lab.mesh.pub
relay_fingerprint=SHA256:...
archive_relay_as=ops/device-public-keys/linux-lab.relay.pub
```

私钥位置固定为：

```text
~/.ssh/id_ed25519_later_mesh
~/.ssh/id_ed25519_later_relay
```

它们权限必须为 `600`，只留在设备本机。通过可信通道把两个 `.pub` 文件复制到 Mac 对应 `ops/device-public-keys/` 路径；不要复制私钥。

直连设备使用：

```bash
./scripts/prepare-device-keys.sh <device-id> direct
```

只生成 management key。

## 5. 更新 inventory

relay 设备示例：

```json
{
  "id": "linux-lab",
  "name": "Linux Lab",
  "role": "lab-workstation",
  "hostname": "linux-lab",
  "os": "Ubuntu 24.04 LTS",
  "arch": "x86_64",
  "account": "later",
  "sshAlias": "later-linux-lab",
  "management": {
    "mode": "relay",
    "relayPort": 33103,
    "relayUser": "later-relay-linux-lab",
    "relayKeyFingerprint": "SHA256:<prepare-device-keys 输出>",
    "service": "systemd --user later-device-relay.service"
  },
  "observedAddresses": [],
  "access": {
    "ssh": "ed25519-public-key",
    "keyFingerprint": "SHA256:<prepare-device-keys 输出>",
    "sudo": "interactive-password-required",
    "passwordState": "not-provided-and-not-required-for-remote-ssh",
    "passwordManagerReference": null
  },
  "paths": {},
  "constraints": []
}
```

同步更新 `updatedAt`，然后运行：

```bash
later-device check
./scripts/render-device-ssh-config.sh --output deploy/device-access/ssh-config
./scripts/test-device-access.sh
```

校验会拒绝：重复 id/alias/relay port/relay user、无效字段、bastion 漂移、缺失公钥和指纹不匹配。

## 6. 生成并审核云端变更计划

public key 默认从 `ops/device-public-keys/` 读取：

```bash
./deploy/device-access/install-cloud.sh --plan
```

计划应显示：

- `devices=N`；
- `relay_devices=M`；
- 新 `relay device=linux-lab ... listen=127.0.0.1:33103`；
- 既有设备和端口没有意外变化。

同步 runtime bundle 到云端；不要使用会删除未知文件的 `--delete`：

```bash
rsync -av -e ssh ops/ later-cloud-admin:/root/.local/share/later-device-access/ops/
rsync -av -e ssh scripts/ later-cloud-admin:/root/.local/share/later-device-access/scripts/
rsync -av -e ssh deploy/device-access/ later-cloud-admin:/root/.local/share/later-device-access/deploy/device-access/
```

在云端再次 plan：

```bash
ssh later-cloud-admin '/root/.local/share/later-device-access/deploy/device-access/install-cloud.sh --plan'
```

## 7. 应用云端受限账号和白名单

保持当前 cloud admin 会话不要关闭，在第二个 Terminal 执行 apply：

```bash
ssh later-cloud-admin '/root/.local/share/later-device-access/deploy/device-access/install-cloud.sh'
```

脚本会：

1. 重建专用 `later-mesh` 的 inventory 派生 `permitopen`；
2. 创建/更新每个 `later-relay-*` 账号的单端口 `permitlisten`；
3. 只替换 bastion 目标账号 `authorized_keys` 中带标记的 managed block；
4. 保留 block 外其他管理员 key；
5. 把被替换的 key 文件备份到 `/var/backups/later-device-access/<UTC timestamp>/`；
6. 执行 `sshd -t`。

立即从至少 2 台既有设备打开新的 cloud admin 连接：

```bash
later-device probe cloud-relay
ssh later-pop 'later-device probe cloud-relay'
```

两条都成功前不要关闭原云端会话。

## 8. 分发目标授权

### 8.1 新设备接受所有来源

在新设备仓库根目录：

```bash
./scripts/authorize-device-key.sh ops/device-public-keys/*.mesh.pub
```

### 8.2 既有目标接受新来源

在每台既有非云目标上运行：

```bash
./scripts/authorize-device-key.sh ops/device-public-keys/linux-lab.mesh.pub
```

云端目标账号由 `install-cloud.sh` 的 managed block 处理，不手工追加重复 key。

总授权条目当前为 O(N²)。达到主手册中的规模阈值时改用 SSH CA，不继续扩大永久公钥矩阵。

## 9. 固定目标 host key

从可信首次通道取得新设备的 host public key：

```bash
# Linux 常见位置
/etc/ssh/ssh_host_ed25519_key.pub
```

核对指纹：

```bash
ssh-keygen -lf ssh_host_ed25519_key.pub
```

在每台来源设备固定相同 alias：

```bash
./scripts/pin-device-host-key.sh later-device-linux-lab ssh_host_ed25519_key.pub
```

host key 不能通过尚未验证的新 relay 自己取得，否则无法建立独立信任。

## 10. 安装 client 与 relay

先在所有既有来源设备安装新生成的 SSH 配置：

```bash
./scripts/install-device-client.sh mac-main
./scripts/install-device-client.sh linux-home
./scripts/install-device-client.sh cloud-relay
```

这些命令只更新 client config 和 `later-device` 入口，不重启既有 relay。

在新设备先看计划：

```bash
./scripts/install-device-relay.sh linux-lab --plan
```

确认账号、hostname、cloud host、relay user 和 port 后安装：

```bash
./scripts/install-device-relay.sh linux-lab
```

Linux 必须确认：

```bash
systemctl --user is-enabled later-device-relay.service
systemctl --user is-active later-device-relay.service
loginctl show-user "$USER" -p Linger
```

若 `Linger=no`，由用户使用 sudo 执行：

```bash
sudo loginctl enable-linger "$USER"
```

## 11. 新设备验收矩阵

### 11.1 功能正向测试

从每台来源执行：

```bash
later-device probe all
later-device facts all
later-device verify-write all
```

N 台设备要求：

- `probe`：N×N 成功；
- `verify-write`：N×N 成功并删除临时文件；
- 新设备 hostname、account、OS、arch 与 inventory 一致。

### 11.2 服务恢复

重启新设备 relay 后确认自动恢复：

```bash
# Linux
systemctl --user restart later-device-relay.service

# macOS
launchctl kickstart -k "gui/$(id -u)/com.later.device-relay"
```

独立来源检查云端 listener 和目标 probe。

### 11.3 安全负向测试

1. 新 relay port 从公网不可连接。
2. `ssh later-bastion 'id'` 不能获得 Shell。
3. `later-bastion` 到未列入 inventory 的端口转发失败。
4. 未授权来源 key 登录目标失败。
5. Host key 错误时连接失败，不能自动接受。

### 11.4 应用回归

如果新设备运行 Pi Web，还要独立完成：health、登录、Session、SSE、模型 Provider、设备切换、服务重启和 Push 约束检查。SSH 管理验收不能替代应用验收。

## 12. 归档和提交

至少更新：

- `ops/device-inventory.json` 与 schema 兼容；
- `ops/device-public-keys/<id>.*.pub`；
- renderer 生成的 `deploy/device-access/ssh-config`；
- `PROJECT_STATE.md` 的部署 commit、设备、端口、服务和验证数量；
- 必要的故障案例和约束。

提交前：

```bash
./scripts/test-device-access.sh
later-device check
git diff --check
git status --short
gh repo view later-3/pi-web --json visibility,isPrivate,url
```

只提交公钥，绝不提交 `.ssh` 私钥、`deploy/secrets/` 或远端凭据原文。

## 13. 失败回滚

新设备安装失败时按逆序回滚：

1. 停止新设备 relay service；
2. 从 inventory 删除新设备并重新 `check/render/test`；
3. 用旧 inventory 重新运行 cloud `--plan` 和 apply，移除新 `permitopen`；
4. 从既有目标撤销新 management key；
5. 删除 `later-device-<id>` known_hosts alias；
6. 验证既有 N×N 矩阵未受影响。

撤销目标 key：

```bash
./scripts/revoke-device-key.sh --plan ops/device-public-keys/linux-lab.mesh.pub
./scripts/revoke-device-key.sh ops/device-public-keys/linux-lab.mesh.pub
```

脚本会备份 `authorized_keys` 到 `~/.local/state/later-device-access/backups/`。

## 14. 下线设备

1. 确认设备没有运行中的 Agent、待同步数据或唯一凭据。
2. 停止该设备 relay，确认云端 listener 消失。
3. 从所有非云目标撤销其 management public key。
4. 从 inventory 删除设备和 tracked public keys，重新 `check/render/test`。
5. cloud `--plan` 确认 `permitopen` 已移除，再 apply。
6. 在所有来源重新安装 client config，删除对应 HostKeyAlias。
7. 云端旧 relay 系统账号不会被脚本自动删除，审核无连接后再锁定/删除。
8. 执行剩余设备的完整 `(N-1)×(N-1)` 验收并更新 `PROJECT_STATE.md`。

不自动删除旧 relay 账号是故意的失败安全设计，避免一次错误 inventory 直接破坏仍在运行的设备。

## 15. 密钥轮换

### 15.1 Management key 零停机轮换

1. 在来源设备生成 `id_ed25519_later_mesh.next`。
2. 把 `.next.pub` 以临时文件加入所有目标和云端 managed key 集合。
3. 用 `ssh -i ...next` 对所有目标验证。
4. 备份旧私钥，把 `.next` 原子替换为固定 `id_ed25519_later_mesh`。
5. 更新 tracked public key、inventory 指纹、cloud 配置并完整测试。
6. 从所有目标撤销旧 public key。

顺序不能反：先授权并测试新 key，再切来源私钥，最后撤销旧 key。

### 15.2 Relay key 轮换

1. 生成 `id_ed25519_later_relay.next`。
2. 更新 tracked relay pub 与 inventory 指纹。
3. cloud `--plan` 后先 apply 新 relay key。
4. 替换目标固定 relay 私钥并重启 service。
5. listener 与 probe 恢复后删除旧备份。

### 15.3 Host key 变化

Host key 变化视为安全事件。先通过控制台/可信 LAN 解释原因并核对新指纹，再运行 `pin-device-host-key.sh`。不得因重装或 IP 变化直接关闭校验。

## 16. 直连与 overlay 设备

有稳定、受保护 SSH 地址或 Tailnet DNS 的设备可用 `management.mode=direct`，无需 `relayPort/relayUser/relay key`。所有来源仍使用同一 alias 和 management public-key授权。

从 relay 切换到 direct 时：

1. 保持旧 relay 可用；
2. 修改 inventory 并生成 SSH config；
3. 从至少 2 个来源测试 direct；
4. 再停止 relay、移除云端 permitopen 和旧 relay account；
5. 保留明确的 break-glass 路径。

不要同时手改各设备 SSH config；route 变更必须通过 inventory + renderer 完成。
