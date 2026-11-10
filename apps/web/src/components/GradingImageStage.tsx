import { useState, type ReactNode } from "react";

type Props = { url?: string | null; alt: string; pageNumber: number; className: string; loading?: "eager" | "lazy"; children?: ReactNode };

export function GradingImageStage(props: Props) {
  return <ImageStage key={`${props.url || ""}:${props.pageNumber}`} {...props} />;
}

function ImageStage({ url, alt, pageNumber, className, loading, children }: Props) {
  const [status, setStatus] = useState<"loading" | "loaded" | "broken">("loading");
  const [attempt, setAttempt] = useState(0);
  return <div className={`${className}${!url || status === "broken" ? " image-unavailable" : ""}`}>
    {!url || status === "broken" ? <div className="grading-image-unavailable" role="status">
      <strong>第 {pageNumber} 页原图无法加载</strong>
      <p>请检查原图文件及服务，恢复后重试。也可<a href="#grading-upload" onClick={() => { const upload = document.querySelector<HTMLDetailsElement>("#grading-upload"); if (upload) upload.open = true; }}>上传新批次</a>；新批次不会替换本记录。</p>
      {url && <button className="secondary-button" type="button" onClick={() => { setStatus("loading"); setAttempt((value) => value + 1); }}>重试加载</button>}
    </div> : <>
      <img key={attempt} src={url} loading={loading} alt={alt} onLoad={() => setStatus("loaded")} onError={() => setStatus("broken")} />
      {status === "loaded" ? children : null}
    </>}
  </div>;
}
