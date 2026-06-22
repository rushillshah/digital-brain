from pathlib import Path, PurePosixPath
import stat


MAX_ZIP_FILES = 20000
MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024


def safe_extract_zip(archive, destination):
    destination = Path(destination).resolve()
    infos = archive.infolist()
    if len(infos) > MAX_ZIP_FILES:
        raise ValueError(f"Refusing to extract archive with {len(infos)} files")
    total_size = sum(info.file_size for info in infos)
    if total_size > MAX_UNCOMPRESSED_BYTES:
        raise ValueError(f"Refusing to extract archive larger than {MAX_UNCOMPRESSED_BYTES} bytes")
    for info in infos:
        validate_zip_member(info, destination)
        archive.extract(info, destination)


def validate_zip_member(info, destination):
    filename = info.filename.replace("\\", "/")
    path = PurePosixPath(filename)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        raise ValueError(f"Unsafe archive member path: {info.filename}")
    target = (destination / Path(*path.parts)).resolve()
    if destination != target and destination not in target.parents:
        raise ValueError(f"Archive member escapes destination: {info.filename}")
    mode = (info.external_attr >> 16) & 0o777777
    if mode and stat.S_ISLNK(mode):
        raise ValueError(f"Refusing to extract symlink from archive: {info.filename}")
