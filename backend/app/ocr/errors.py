from app.errors import AppError


class UnsupportedImageTypeError(AppError):
    code = "unsupported_image_type"
    status_code = 415
    message = "That file type isn't supported. Please upload a JPEG, PNG or WebP image."


class ImageTooLargeError(AppError):
    code = "image_too_large"
    status_code = 413
    message = "That image is too large. Please use an image under 10 MB."


class InvalidImageError(AppError):
    code = "invalid_image"
    status_code = 400
    message = "We couldn't open that image. It may be damaged or not a real image file."


class NoTextFoundError(AppError):
    code = "no_text_found"
    status_code = 422
    message = (
        "We couldn't read any text in this photo. Try again with the ingredients list filling "
        "the frame, in good light and in focus."
    )


class OcrUnavailableError(AppError):
    code = "ocr_unavailable"
    status_code = 503
    message = "Text recognition is temporarily unavailable. Please try again later."


class OcrTimeoutError(AppError):
    code = "ocr_timeout"
    status_code = 504
    message = "Reading this image took too long. Try a clearer or smaller photo."


class OcrFailedError(AppError):
    code = "ocr_failed"
    status_code = 500
    message = "Something went wrong while reading this image. Please try again."
