// testapp.cpp — a simple glX app that renders a spinning triangle
// compile: g++ testapp.cpp -o testapp -lGL -lX11 -lGLU
#include <GL/gl.h>
#include <GL/glx.h>
#include <X11/Xlib.h>
#include <cmath>
#include <unistd.h>

int main(int argc, char *argv[]) {
  Display *dpy = XOpenDisplay(nullptr);
  int screen = DefaultScreen(dpy);

  int attribs[] = {GLX_RGBA, GLX_DEPTH_SIZE, 24, GLX_DOUBLEBUFFER, None};
  XVisualInfo *vi = glXChooseVisual(dpy, screen, attribs);

  XSetWindowAttributes swa;
  swa.colormap =
      XCreateColormap(dpy, RootWindow(dpy, screen), vi->visual, AllocNone);
  swa.event_mask = ExposureMask | KeyPressMask;

  Window win =
      XCreateWindow(dpy, RootWindow(dpy, screen), 0, 0, 800, 600, 0, vi->depth,
                    InputOutput, vi->visual, CWColormap | CWEventMask, &swa);
  XMapWindow(dpy, win);
  XStoreName(dpy, win, "GL Test Target");

  GLXContext ctx = glXCreateContext(dpy, vi, nullptr, GL_TRUE);
  glXMakeCurrent(dpy, win, ctx);

  float angle = 0.0f;
  while (true) {
    glClearColor(0.1f, 0.1f, 0.2f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    glLoadIdentity();
    glRotatef(angle, 0, 0, 1);
    angle += 1.0f;

    glBegin(GL_TRIANGLES);
    glColor3f(1, 0, 0);
    glVertex2f(0.0f, 0.5f);
    glColor3f(0, 1, 0);
    glVertex2f(-0.5f, -0.5f);
    glColor3f(0, 0, 1);
    glVertex2f(0.5f, -0.5f);
    glEnd();

    glXSwapBuffers(dpy, win);
    usleep(16000);
  }
}
