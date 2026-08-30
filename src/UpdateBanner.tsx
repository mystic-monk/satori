import { useState } from "react";
import { installUpdateAndRelaunch, type Update } from "./updater";

interface UpdateBannerProps {
  update: Update;
  onDismiss: () => void;
}

export default function UpdateBanner({ update, onDismiss }: UpdateBannerProps) {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onUpdateNow() {
    setInstalling(true);
    setError(null);
    try {
      // Doesn't return on success — installUpdateAndRelaunch relaunches
      // the app itself once installed, so there's no "done" state to
      // show here, only a failure path.
      await installUpdateAndRelaunch(update, (downloaded, total) => {
        setProgress(total ? Math.round((downloaded / total) * 100) : null);
      });
    } catch {
      setInstalling(false);
      setError("Update failed — try again, or download it manually from the Releases page.");
    }
  }

  return (
    <div className="update-banner">
      <span className="update-banner-text">
        Satori {update.version} is available — you're on {update.currentVersion}.
      </span>
      {error && <span className="update-banner-error">{error}</span>}
      {installing ? (
        <span className="update-banner-progress">
          {progress !== null ? `Installing… ${progress}%` : "Installing…"}
        </span>
      ) : (
        <div className="update-banner-actions">
          <button onClick={onUpdateNow}>Update Now</button>
          <button onClick={onDismiss}>Later</button>
        </div>
      )}
    </div>
  );
}
