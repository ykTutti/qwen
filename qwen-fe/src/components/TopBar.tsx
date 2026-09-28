import type { Surface, ToastFn } from '../types';
import { useConfig } from '../config';
import subscribeIcon from '../assets/subscribe-light.png';

const API_SERVICE_URL = 'https://www.qianwenai.com/?source_channel=hy_qwen&utm_content=g_1000415132';
import { Icon } from './Icon';
import { Popover } from './Popover';

interface Props {
  surface: Surface;
  model: string;
  loggedIn: boolean;
  inChat: boolean;
  sidebarCollapsed: boolean;
  onModel: (key: string) => void;
  onToggleSidebar: () => void;
  onNew: () => void;
  onLogin: () => void;
  toast: ToastFn;
}

export function TopBar(props: Props) {
  const { models } = useConfig();
  const current = models.find((m) => m.key === props.model) ?? models[0];

  return (
    <header className="topbar">
      <div className="topbar-left">
        {props.sidebarCollapsed && (
          <>
            <button className="icon-btn" title="展开侧边栏" onClick={props.onToggleSidebar}><Icon name="sidebarRight" /></button>
            <button className="icon-btn" title="新对话" onClick={props.onNew}><Icon name="newDialogue" /></button>
          </>
        )}
        {props.surface === 'daily' && (
          <Popover
            className="popover-model"
            trigger={(open, toggle) => (
              <button className={`model-trigger ${open ? 'is-open' : ''}`} onClick={toggle}>
                {current.name}
                <Icon name="down" size={12} className={`chevron ${open ? 'is-up' : ''}`} />
              </button>
            )}
          >
            {(close) => (
              <div className="model-panel">
                <header className="model-panel-head"><span>模型</span></header>
                <div className="model-panel-list">
                  {models.map((m) => (
                    <button
                      key={m.key}
                      className={`model-item ${m.key === props.model ? 'is-active' : ''}`}
                      onClick={() => { props.onModel(m.key); close(); }}
                    >
                      <span className="model-item-text">
                        <span className="model-item-name">{m.name}</span>
                        <span className="model-item-desc">{m.desc}</span>
                      </span>
                      <span className="model-item-check"><Icon name="qwpcicon-check" /></span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Popover>
        )}
      </div>

      <div className="topbar-right">
        {props.loggedIn && props.surface === 'work' ? (
          <>
            <button className="btn-subscribe" onClick={() => props.toast('订阅会员（mock）')}>
              <img src={subscribeIcon} width={16} height={16} alt="" draggable={false} />
              订阅会员
            </button>
            <UploadRecords />
          </>
        ) : (
          <>
            {!props.inChat && (
              <>
                <button className="btn-text" onClick={() => window.open(API_SERVICE_URL, '_blank', 'noopener')}><Icon name="API" />API 服务</button>
                <button className="btn-outline" onClick={() => props.toast('开始下载千问电脑端（mock）')}><span className="btn-icon-tall"><Icon name="appleDevice" /></span>下载电脑端</button>
              </>
            )}
            {props.loggedIn ? (
              <UploadRecords />
            ) : (
              !props.inChat && <button className="btn-primary" onClick={props.onLogin}>登录</button>
            )}
          </>
        )}
      </div>
    </header>
  );
}

function UploadRecords() {
  return (
    <Popover
      placement="bottom-end"
      className="popover-upload"
      trigger={(open, toggle) => (
        <button className={`icon-btn upload-btn ${open ? 'is-open' : ''}`} data-tip={open ? undefined : '上传记录'} onClick={toggle}>
          <Icon name="transmissionNew" />
        </button>
      )}
    >
      {() => (
        <div className="upload-panel">
          <span className="upload-panel-title">上传记录</span>
          <div className="upload-empty">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="upload-empty-row">
                <div className="upload-empty-card">
                  <i className="upload-empty-icon" />
                  <div className="upload-empty-lines"><i /><i /></div>
                </div>
              </div>
            ))}
            <div className="upload-empty-mask"><p>暂无上传记录</p></div>
          </div>
        </div>
      )}
    </Popover>
  );
}
