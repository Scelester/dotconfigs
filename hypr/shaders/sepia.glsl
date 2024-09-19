precision highp float;
varying vec2 v_texcoord;
uniform sampler2D tex;

void main() {
    vec4 pixColor = texture2D(tex, v_texcoord);
    float r = pixColor.r;
    float g = pixColor.g;
    float b = pixColor.b;

    float tr = 0.393 * r + 0.769 * g + 0.189 * b;
    float tg = 0.349 * r + 0.686 * g + 0.168 * b;
    float tb = 0.272 * r + 0.534 * g + 0.131 * b;

    gl_FragColor = vec4(tr, tg, tb, pixColor.a);
}
