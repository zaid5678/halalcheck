"""Application errors that map directly onto JSON error responses."""


class AppError(Exception):
    """Base error. Subclasses set a machine-readable code, HTTP status and default message."""

    code = "internal_error"
    status_code = 500
    message = "Something went wrong. Please try again."

    def __init__(self, message: str | None = None) -> None:
        if message is not None:
            self.message = message
        super().__init__(self.message)


class InvalidInputError(AppError):
    code = "invalid_request"
    status_code = 400
    message = "The request was not valid."
