// shared_capture.h - shared between injected lib and your capture code
#include <cstdint>
#include <cstddef>

struct SharedCaptureBuffer {
  uint32_t width;
  uint32_t height;
  uint32_t sequence; // incremented each frame, for dirty detection
  uint32_t ready;
  uint8_t data[]; // BGRA pixels follow in memory
};

constexpr size_t SHARED_MEM_MAX = 4096 * 4096 * 4 + sizeof(SharedCaptureBuffer);
constexpr const char *SHARED_MEM_NAME = "/altus_gl_capture";
