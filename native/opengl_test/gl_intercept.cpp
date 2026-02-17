// gl_intercept.cpp
// This entire file becomes libglcapture.so when compiled with -shared -fPIC

#define GL_GLEXT_PROTOTYPES
#include <GL/gl.h>
#include <GL/glx.h>
#include <cstring>
#include <dlfcn.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

struct SharedCaptureBuffer {
  uint32_t width;
  uint32_t height;
  uint32_t sequence;
  uint32_t ready;
  uint8_t data[];
};

constexpr const char *SHARED_MEM_NAME = "/altus_gl_capture";

static SharedCaptureBuffer *g_shm = nullptr;
static int g_shm_fd = -1;
static void (*real_glXSwapBuffers)(Display *, GLXDrawable) = nullptr;

static void initSharedMem(int width, int height) {
  size_t size = sizeof(SharedCaptureBuffer) + width * height * 4;
  shm_unlink(SHARED_MEM_NAME);
  g_shm_fd = shm_open(SHARED_MEM_NAME, O_CREAT | O_RDWR, 0666);
  if (g_shm_fd < 0)
    return;
  ftruncate(g_shm_fd, size);
  g_shm = (SharedCaptureBuffer *)mmap(nullptr, size, PROT_READ | PROT_WRITE,
                                      MAP_SHARED, g_shm_fd, 0);
  if (g_shm == MAP_FAILED) {
    g_shm = nullptr;
    return;
  }
  g_shm->width = width;
  g_shm->height = height;
  g_shm->sequence = 0;
  g_shm->ready = 0;
}

extern "C" void glXSwapBuffers(Display *dpy, GLXDrawable drawable) {
  if (!real_glXSwapBuffers)
    real_glXSwapBuffers =
        (void (*)(Display *, GLXDrawable))dlsym(RTLD_NEXT, "glXSwapBuffers");

  unsigned int width = 0, height = 0;
  glXQueryDrawable(dpy, drawable, GLX_WIDTH, &width);
  glXQueryDrawable(dpy, drawable, GLX_HEIGHT, &height);

  if (!g_shm || g_shm->width != width || g_shm->height != height)
    initSharedMem(width, height);

  if (g_shm) {
    glReadBuffer(GL_FRONT);
    glReadPixels(0, 0, width, height, GL_BGRA, GL_UNSIGNED_BYTE, g_shm->data);

    // Flip rows — OpenGL origin is bottom-left
    size_t rowBytes = width * 4;
    std::vector<uint8_t> tmp(rowBytes);
    for (unsigned int y = 0; y < height / 2; ++y) {
      uint8_t *top = g_shm->data + y * rowBytes;
      uint8_t *bot = g_shm->data + (height - 1 - y) * rowBytes;
      memcpy(tmp.data(), top, rowBytes);
      memcpy(top, bot, rowBytes);
      memcpy(bot, tmp.data(), rowBytes);
    }

    __sync_fetch_and_add(&g_shm->sequence, 1);
    __atomic_store_n(&g_shm->ready, 1, __ATOMIC_RELEASE);
  }

  real_glXSwapBuffers(dpy, drawable);
}
