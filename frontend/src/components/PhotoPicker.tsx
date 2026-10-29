import { lazy, Suspense, useCallback, useRef, useState, type ChangeEvent } from 'react'
import { cameraPreflightError, prefersNativeCamera } from '../lib/camera'
import { IMAGE_ACCEPT } from '../lib/image'
import { CameraIcon, UploadIcon } from './icons'

const CameraCapture = lazy(() =>
  import('./CameraCapture').then((module) => ({ default: module.CameraCapture })),
)

export type PhotoSource = 'camera' | 'upload'

interface PhotoPickerProps {
  onSelect: (file: File, source: PhotoSource) => void
  /** Render the buttons compactly, e.g. as "Retake" / "Choose another" under a preview. */
  variant?: 'primary' | 'compact'
}

/**
 * "Take photo" and "Upload image" controls. On phones, "Take photo" opens the system camera
 * through a file input, which handles permissions itself. On computers it opens an in-page
 * camera, which asks for permission only at that point.
 */
export function PhotoPicker({ onSelect, variant = 'primary' }: PhotoPickerProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [cameraOpen, setCameraOpen] = useState(false)

  function takePhoto() {
    if (prefersNativeCamera() || cameraPreflightError()) {
      cameraInputRef.current?.click()
    } else {
      setCameraOpen(true)
    }
  }

  function handleFileChange(source: PhotoSource) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      // Reset so choosing the same file again still fires a change event.
      event.target.value = ''
      if (file) onSelect(file, source)
    }
  }

  const closeCamera = useCallback(() => setCameraOpen(false), [])
  const uploadInstead = useCallback(() => {
    setCameraOpen(false)
    uploadInputRef.current?.click()
  }, [])
  const handleCapture = useCallback(
    (file: File) => {
      setCameraOpen(false)
      onSelect(file, 'camera')
    },
    [onSelect],
  )

  const compact = variant === 'compact'

  return (
    <>
      <div className={compact ? 'grid grid-cols-2 gap-2' : 'grid gap-3 sm:grid-cols-2'}>
        <button
          type="button"
          onClick={takePhoto}
          className={compact ? 'btn-secondary gap-1.5 px-3 whitespace-nowrap' : 'btn-primary h-14 gap-2 text-base'}
        >
          <CameraIcon className="size-5" />
          {compact ? 'Retake' : 'Take photo'}
        </button>
        <button
          type="button"
          onClick={() => uploadInputRef.current?.click()}
          className={compact ? 'btn-secondary gap-1.5 px-3 whitespace-nowrap' : 'btn-secondary h-14 gap-2 text-base'}
        >
          <UploadIcon className="size-5" />
          {compact ? 'Choose another' : 'Upload image'}
        </button>
      </div>

      <input
        ref={cameraInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        capture="environment"
        className="hidden"
        aria-label="Take a photo with your camera"
        onChange={handleFileChange('camera')}
      />
      <input
        ref={uploadInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        aria-label="Upload an image file"
        onChange={handleFileChange('upload')}
      />

      {cameraOpen && (
        <Suspense fallback={null}>
          <CameraCapture
            onCapture={handleCapture}
            onClose={closeCamera}
            onUploadInstead={uploadInstead}
          />
        </Suspense>
      )}
    </>
  )
}
