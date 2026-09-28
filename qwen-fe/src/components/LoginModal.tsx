import { useEffect, useRef, useState } from 'react';
import { api, tokenStore } from '../api/client';
import type { User } from '../types';
import { Icon, LogoMark } from './Icon';

interface Props {
  onClose: () => void;
  onSuccess: (user: User) => void;
}

export function LoginModal({ onClose, onSuccess }: Props) {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const accountRef = useRef<HTMLInputElement>(null);
  const pwdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    accountRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canSubmit = account.trim().length > 0 && password.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    if (!agree) return setError('请先阅读并同意用户协议和隐私政策');
    setError('');
    setSubmitting(true);
    try {
      const { token, user } = await api.login(account.trim(), password);
      tokenStore.set(token);
      onSuccess(user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal login-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="icon-btn modal-close" onClick={onClose}><Icon name="close" /></button>
        <div className="login-head">
          <LogoMark size={40} />
          <h2>登录千问</h2>
          <p>登录后可同步历史对话，解锁更多功能</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="field">
            <Icon name="user" className="field-icon" />
            <input
              ref={accountRef}
              value={account}
              autoComplete="username"
              placeholder="手机号 / 邮箱 / 用户名"
              onChange={(e) => { setAccount(e.target.value); setError(''); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !password) {
                  e.preventDefault();
                  pwdRef.current?.focus();
                }
              }}
            />
            {account && (
              <button type="button" className="field-clear" title="清空" onClick={() => { setAccount(''); accountRef.current?.focus(); }}>
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
          <div className="field">
            <Icon name="lock" className="field-icon" />
            <input
              ref={pwdRef}
              type={showPwd ? 'text' : 'password'}
              value={password}
              autoComplete="current-password"
              placeholder="请输入密码"
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
            />
            <button type="button" className="field-clear" title={showPwd ? '隐藏密码' : '显示密码'} onClick={() => setShowPwd((v) => !v)}>
              <Icon name={showPwd ? 'eye' : 'eyeOff'} />
            </button>
          </div>
          <div className="login-row">
            <span className="login-error">{error}</span>
            <button type="button" className="login-link" onClick={() => setError('找回密码暂未开放（mock）')}>忘记密码？</button>
          </div>
          <button type="submit" className="btn-primary block lg" disabled={!canSubmit}>
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>
        <label className="agree">
          <input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); setError(''); }} />
          <span>我已阅读并同意 <a href="#" onClick={(e) => e.preventDefault()}>用户协议</a> 和 <a href="#" onClick={(e) => e.preventDefault()}>隐私政策</a></span>
        </label>
        <div className="login-foot">
          还没有账号？<button type="button" className="login-link" onClick={() => setError('注册暂未开放（mock）')}>立即注册</button>
        </div>
        <div className="login-tip">演示环境：任意账号 + 至少 6 位密码即可登录</div>
      </div>
    </div>
  );
}
