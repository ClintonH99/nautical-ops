import { Alert, type AlertButton, type AlertOptions } from 'react-native';
import { BACKGROUND_THEMES, useThemeStore } from '../store';

let installed = false;
let nextId = 0;
const queue: Array<() => void> = [];
let showing = false;

/** RN Web's Alert.alert is a no-op. Keep its API and callbacks, with a real
 * accessible browser dialog. No action is run until its button is selected. */
export function installWebAlerts(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  Alert.alert = (
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: AlertOptions
  ) => {
    queue.push(() => {
      const colors = BACKGROUND_THEMES[useThemeStore.getState().backgroundTheme];
      const previousFocus = document.activeElement as HTMLElement | null;
      const dialog = document.createElement('dialog');
      const id = `nautical-alert-${++nextId}`;
      dialog.setAttribute('aria-labelledby', `${id}-title`);
      dialog.setAttribute('aria-describedby', `${id}-message`);
      dialog.style.cssText = `box-sizing:border-box;width:min(440px,calc(100vw - 32px));max-height:85vh;overflow:auto;padding:24px;border:1px solid ${colors.border};border-radius:20px;background:${colors.surface};color:${colors.textPrimary};font:16px Arial,sans-serif;`;
      const style = document.createElement('style');
      style.textContent = `dialog[data-nautical-alert]::backdrop{background:rgba(0,0,0,.5)} dialog[data-nautical-alert] button:focus-visible{outline:3px solid ${colors.borderStrong};outline-offset:3px}`;
      dialog.dataset.nauticalAlert = '';
      const heading = document.createElement('h2');
      heading.id = `${id}-title`;
      heading.textContent = title;
      heading.style.cssText =
        'font-size:20px;line-height:1.3;margin:0 0 12px;overflow-wrap:anywhere';
      const body = document.createElement('p');
      body.id = `${id}-message`;
      body.textContent = message ?? '';
      body.style.cssText = `white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;margin:0 0 24px;color:${colors.textSecondary}`;
      const actions = document.createElement('div');
      const choices = buttons?.length ? buttons : [{ text: 'OK' }];
      actions.style.cssText = `display:flex;gap:12px;flex-direction:${choices.length > 2 ? 'column' : 'row'};flex-wrap:wrap`;
      let closed = false;
      const finish = (callback?: () => void) => {
        if (closed) return;
        closed = true;
        dialog.close();
        dialog.remove();
        previousFocus?.focus();
        showing = false;
        try {
          callback?.();
        } finally {
          showNext();
        }
      };
      for (const choice of choices) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = choice.text || 'OK';
        const cancel = choice.style === 'cancel';
        const destructive = choice.style === 'destructive';
        button.style.cssText = `flex:1;min-width:100px;min-height:48px;padding:12px 16px;cursor:pointer;white-space:normal;overflow-wrap:anywhere;border-radius:12px;font:600 16px Arial,sans-serif;border:1px solid ${cancel ? colors.border : destructive ? '#dc2626' : '#1E3A8A'};background:${cancel ? colors.control : destructive ? '#dc2626' : '#1E3A8A'};color:${cancel ? colors.textPrimary : '#fff'};`;
        button.addEventListener('click', () => finish(choice.onPress));
        // Default keyboard focus must never land on a destructive action.
        if (cancel) button.autofocus = true;
        actions.appendChild(button);
      }
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        const cancel = choices.find((choice) => choice.style === 'cancel');
        if (cancel) finish(cancel.onPress);
        else if (options?.cancelable) finish(options.onDismiss);
      });
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog || !options?.cancelable) return;
        const bounds = dialog.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          finish(options.onDismiss);
        }
      });
      dialog.append(style, heading, body, actions);
      document.body.appendChild(dialog);
      dialog.showModal();
    });
    showNext();
  };
}

function showNext() {
  if (showing) return;
  const next = queue.shift();
  if (!next) return;
  showing = true;
  next();
}
