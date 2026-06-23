import hashlib

from django.contrib.auth.hashers import BasePasswordHasher, mask_hash
from django.utils.crypto import constant_time_compare


class LegacyAEISPasswordHasher(BasePasswordHasher):
    """Read-only compatibility for passwords from the retired backend."""

    algorithm = "legacy_aeis"

    def salt(self):
        raise NotImplementedError("Legacy hashes are imported with their original salt.")

    def encode(self, password, salt):
        digest = hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()
        return f"{self.algorithm}${salt}${digest}"

    def verify(self, password, encoded):
        algorithm, salt, _ = encoded.split("$", 2)
        return algorithm == self.algorithm and constant_time_compare(self.encode(password, salt), encoded)

    def safe_summary(self, encoded):
        algorithm, salt, digest = encoded.split("$", 2)
        return {"algorithm": algorithm, "salt": mask_hash(salt), "hash": mask_hash(digest)}

    def must_update(self, encoded):
        return True
