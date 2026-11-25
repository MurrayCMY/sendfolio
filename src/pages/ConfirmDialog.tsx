import { IconAlert } from "../ui/icons";
import { Modal } from "../ui/Modal";
import { t } from "../i18n";

/** In-app replacement for window.confirm: states the consequence and puts focus on the safe button first. */
export function ConfirmDialog(props: {
  title: string;
  body: any;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal labelledBy="cd-title" role="alertdialog" busy={props.busy} dismissOnOverlay onClose={props.onClose}>
      <h2 id="cd-title" class="cd-title">{props.danger && <span class="cd-icon"><IconAlert size={20} /></span>}{props.title}</h2>
      <div id="cd-body" class="muted" style={{ marginTop: "6px" }}>{props.body}</div>
      <div class="row end">
        <button data-autofocus class="btn" disabled={props.busy} onClick={props.onClose}>{t("Cancel")}</button>
        <button class={`btn ${props.danger ? "btn-danger" : "btn-primary"}`} disabled={props.busy} onClick={props.onConfirm}>
          {props.busy ? t("Working…") : props.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
