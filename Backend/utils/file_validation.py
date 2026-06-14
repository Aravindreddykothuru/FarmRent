"""
utils/file_validation.py
-------------------------
Utilities for validating uploaded files, checking magic bytes, and verifying sizes.
"""

from fastapi import HTTPException, status

def validate_image_file_signature(contents: bytes, filename: str) -> None:
    """
    Validate that the file contents start with the correct image magic bytes (JPEG or PNG).
    Raises an HTTPException if the magic bytes do not match.
    """
    # JPEG magic bytes: FF D8 FF
    # PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    is_jpeg = contents.startswith(b"\xff\xd8\xff")
    is_png = contents.startswith(b"\x89PNG\r\n\x1a\n")
    
    if not (is_jpeg or is_png):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File {filename} is not a valid JPEG or PNG image (invalid file signature).",
        )
