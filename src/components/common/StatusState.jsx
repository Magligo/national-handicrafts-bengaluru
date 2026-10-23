export function LoadingState({ label = 'Loading the catalogue…' }) {
  return <div className="status-state" role="status"><p>{label}</p></div>;
}

export function ErrorState({ onRetry, message }) {
  return <div className="status-state error-state" role="alert"><p>We could not load the catalogue.</p><span>{message || 'Check that the API is running, then try again.'}</span>{onRetry && <button className="button secondary" onClick={onRetry}>Try again</button>}</div>;
}
