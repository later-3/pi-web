"use client";

import { FormEvent, useState } from "react";
import { IconAlertCircle, IconEye, IconEyeOff, IconInfoCircle, IconLock } from "@tabler/icons-react";
import styles from "./login.module.css";

interface Props {
  nextPath: string;
  expired: boolean;
  configurationError: boolean;
}

function errorMessage(status: number): string {
  if (status === 401) return "用户名或密码错误，请重新输入。";
  if (status === 429) return "尝试次数过多，请稍后再试。";
  if (status === 503) return "登录服务尚未正确配置，请检查部署设置。";
  return "暂时无法登录，请检查网络后重试。";
}

export function LoginForm({ nextPath, expired, configurationError }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [persistent, setPersistent] = useState(true);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(configurationError
    ? "登录服务尚未正确配置，请检查部署设置。"
    : expired ? "会话已过期，请重新登录。" : null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, persistent }),
      });
      if (!response.ok) {
        setError(errorMessage(response.status));
        return;
      }
      window.location.replace(nextPath);
    } catch {
      setError("暂时无法登录，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.login} aria-labelledby="login-title">
        <div className={styles.brand} aria-label="Pi Web">
          <span className={styles.brandMark} aria-hidden="true">π</span>
          <span>Pi Web</span>
        </div>

        <div className={styles.intro}>
          <h1 id="login-title">登录到 Pi Web</h1>
          <p>{expired ? "会话已过期，请重新登录以继续。" : "验证身份后继续使用 Pi Web。"}</p>
        </div>

        {error && (
          <div className={styles.alert} role="alert">
            <IconAlertCircle size={20} stroke={1.9} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            <span>用户名</span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入用户名"
              required
              autoFocus
              disabled={busy}
            />
          </label>

          <label className={styles.field}>
            <span>密码</span>
            <span className={styles.passwordField}>
              <input
                name="password"
                type={passwordVisible ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                required
                disabled={busy}
              />
              <button
                type="button"
                className={styles.visibilityButton}
                onClick={() => setPasswordVisible((visible) => !visible)}
                aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
              >
                {passwordVisible
                  ? <IconEyeOff size={20} stroke={1.8} aria-hidden="true" />
                  : <IconEye size={20} stroke={1.8} aria-hidden="true" />}
              </button>
            </span>
          </label>

          <label className={styles.remember}>
            <input
              type="checkbox"
              checked={persistent}
              onChange={(event) => setPersistent(event.target.checked)}
              disabled={busy}
            />
            <span>保持登录 30 天</span>
            <IconInfoCircle size={16} stroke={1.7} aria-label="关闭后仍保持登录；取消勾选则使用临时会话" />
          </label>

          <button className={styles.submit} type="submit" disabled={busy || !username || !password}>
            {busy ? "登录中…" : "登录"}
          </button>
        </form>

        <div className={styles.securityNote}>
          <IconLock size={17} stroke={1.8} aria-hidden="true" />
          <p>会话通过 HTTPS 加密传输，密码不会保存在浏览器中。</p>
        </div>
      </section>
    </main>
  );
}
