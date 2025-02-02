precision highp float;
varying vec2 v_texcoord;
uniform sampler2D tex;

void main() {
    vec4 pixColor = texture2D(tex, v_texcoord);
    float gray = (pixColor.r + pixColor.g + pixColor.b) / 3.0;
    gl_FragColor = vec4(gray, gray, gray, pixColor.a);
}
