# Later Code Workspace

## 跨设备访问与配置

当用户要求访问、检查或配置另一台设备时，使用已经部署的 Later device-access 控制层，不依赖设备是否位于同一局域网。

- 设备 id：`mac-main`（Mac）、`linux-home`（Pop!_OS）、`cloud-relay`（云服务器）。
- 首选命令：`later-device`。若当前 PATH 找不到它，Mac 使用 `/Users/xulater/Code/pi-web/scripts/device-access.sh`，Pop!_OS 使用 `/home/later/.local/share/later-device-access/scripts/device-access.sh`。
- 先执行 `facts <device-id>` 和必要的 `probe <device-id>`，完整只读检查使用 `audit all`，再执行 `run <device-id> -- <command>`；交互式操作使用 `ssh later-mac|later-pop|later-cloud-admin`。
- 实际环境清单位于 Mac 的 `/Users/xulater/Code/pi-web/ops/device-inventory.json` 和 Pop!_OS 的 `/home/later/Code/pi-web/ops/device-inventory.json`；操作手册为对应仓库的 `docs/device-access.zh-CN.md`。
- LAN IP 只作诊断，不作为自动化入口。管理别名固定走受限云端 loopback relay；不得把云端 `33101/33102` 监听暴露到公网。
- 不得读取、打印、复制或提交密码、私钥、Token、Cookie、Provider Key 和会话签名密钥。涉及 sudo、SSH daemon、防火墙、账号权限、删除或覆盖未知工作区时，先检查现状、备份并保留回滚。
- 新增、下线、变更路由或轮换密钥必须遵循 Pi Web 仓库的 `docs/device-onboarding.zh-CN.md`（Mac：`/Users/xulater/Code/pi-web`；Pop：`/home/later/Code/pi-web`）；inventory 是唯一事实源，SSH config 和云端白名单由脚本生成，不直接手改。
